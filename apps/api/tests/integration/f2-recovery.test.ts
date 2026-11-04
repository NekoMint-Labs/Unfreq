import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";
import { digestPublicationContent } from "../../src/modules/signals/publication.js";
import { buildMinimalSignalProgram } from "../../src/modules/signals/service-mappers.js";
import { fixtureExpansion, fixtureFingerprint, fixtureSeed } from "./fixtures.js";
import { assertManagedIntegrationEnvironment, configureIsolatedEnvironment, installFetchBoundary } from "./harness.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
type Sql = ReturnType<typeof postgres>;

// No external URL/project arguments: this drill can operate only inside the
// existing managed runner's newly created local Docker project.
it("F2 restores a synthetic SQL/media/config checkpoint into an empty isolated database and replays newer withdrawal state before opening reads", async () => {
  const managed = assertManagedIntegrationEnvironment();
  if (!/^[a-f0-9]{12}$/u.test(managed.runId)) throw new Error("Unexpected recovery run identifier.");
  const runtime = await verifyIntegrationRuntime({ repositoryRoot: root, runId: managed.runId,
    runtimeDirectory: process.env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "", ownershipToken: process.env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "" });
  const runDirectory = resolve(runtime.runtimeDirectory, "..");
  if (relative(join(root, "test-results", "integration"), runDirectory).includes("..")) throw new Error("Unowned recovery evidence directory.");
  const directory = join(runDirectory, "f2-recovery");
  await mkdir(directory); // Never adopt an earlier drill's artifacts.
  const project = `unfreq-it-${managed.runId}`;
  const sourceName = `unfreq_integration_f2_${randomBytes(6).toString("hex")}_source`;
  const targetName = sourceName.replace(/source$/u, "target");
  const nonce = randomUUID();
  const admin = postgres(managed.databaseUrl, { infer: true, max: 1, prepare: false, connect_timeout: 5 });
  const owned = new Set<string>();
  const connections: Sql[] = [];
  let app: FastifyInstance | undefined;
  let restoreEnvironment: (() => Promise<void>) | undefined;
  let restoreFetch: ReturnType<typeof installFetchBoundary> | undefined;
  const events: Record<string, unknown> = { syntheticOnly: true, runId: managed.runId, sourceName, targetName, startedAt: new Date().toISOString() };
  let failure: unknown;
  const cleanupErrors: unknown[] = [];

  const systemKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"]);
  const shellEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key.toUpperCase())));
  const processEvents: Array<Record<string, unknown>> = [];
  events.processes = processEvents;
  let shell = "sh";
  if (process.platform === "win32") {
    const candidates = ["D:/git/Git/bin/bash.exe", join(process.env.PROGRAMFILES ?? "C:/Program Files", "Git/bin/bash.exe"),
      ...(process.env.PATH ?? "").split(";").flatMap((entry) => [join(entry, "bash.exe"), join(entry, "../bin/bash.exe")])];
    const available: string[] = [];
    for (const candidate of candidates) { try { await access(candidate); available.push(candidate); } catch { /* Try only local installed shells. */ } }
    if (!available[0]) throw new Error("The synthetic recovery drill requires a local POSIX shell.");
    shell = available[0];
  }
  const runProcess = (command: string, args: string[], overrides: Record<string, string> = {}, expectedSuccess = true, input?: string) => new Promise<string>((yes, no) => {
    const stage = command === "docker" ? "linux-permissions" : ["backup", "restore", "f2-media-backup", "f2-media-restore"].includes(args[2] ?? "") ? args[2]! : "local-shell";
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd: root, env: { ...shellEnvironment, ...overrides }, shell: false, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let bytes = 0; let stdout = ""; let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
    child.stdout!.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 65_536) stdout += chunk.toString("utf8"); });
    child.stderr!.on("data", (chunk: Buffer) => { bytes += chunk.length; });
    // Errors from pg_dump/psql can contain synthetic content. Never persist or
    // echo arbitrary tool output; retain fixed stage names and exit codes only.
    child.once("error", () => { clearTimeout(timeout); no(new Error("Recovery subprocess could not start.")); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      processEvents.push({ stage, elapsedMs: Date.now() - startedAt, code, timedOut, expectedSuccess });
      if (timedOut || code === null || bytes > 65_536 || (code === 0) !== expectedSuccess) no(new Error("Recovery subprocess returned an unexpected outcome."));
      else yes(stdout);
    });
    child.stdin?.on("error", () => { /* Child exit is checked above. */ });
    if (input !== undefined) child.stdin?.end(input);
  });
  const runShell = (args: string[], overrides: Record<string, string> = {}, expectedSuccess = true) => runProcess(shell, args, overrides, expectedSuccess);
  const rel = (name: string) => relative(root, join(directory, name)).replaceAll("\\", "/");
  const stackEnvironment = (database: string) => ({
    UNFREQ_COMPOSE_FILES: `--project-name ${project} --file tests/integration/compose.yaml --env-file ${relative(root, join(runDirectory, "empty.env")).replaceAll("\\", "/")}`,
    UNFREQ_API_ENV_FILE: relative(root, join(runDirectory, "empty.env")).replaceAll("\\", "/"),
    UNFREQ_PG_USER: "unfreq_test", UNFREQ_PG_DATABASE: database,
    UNFREQ_BACKUP_FILE: rel("checkpoint.sql.gz"), UNFREQ_RESTORE_ISOLATED: "true",
  });
  try {
    const [identity] = await admin`select current_database() as db, current_user as username`;
    if (identity?.db !== "unfreq_integration" || identity.username !== "unfreq_test") throw new Error("Recovery requires the runner's synthetic database owner.");
    for (const name of [sourceName, targetName]) {
      if (!/^unfreq_integration_f2_[a-f0-9]{12}_(source|target)$/u.test(name) || (await admin`select datname from pg_database where datname=${name}`).length) throw new Error("Recovery refuses an existing database.");
      await admin`create database ${admin(name)}`; owned.add(name);
    }
    const connect = (name: string) => {
      const url = new URL(managed.databaseUrl); url.pathname = `/${name}`;
      const sql = postgres(url.toString(), { infer: true, max: 1, prepare: false, connect_timeout: 5 }); connections.push(sql); return { sql, url: url.toString() };
    };
    const source = connect(sourceName); const target = connect(targetName);
    await migrate(drizzle(source.sql), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    await source.sql`create table f2_recovery_ownership (run_id text, nonce uuid)`;
    await source.sql`insert into f2_recovery_ownership values (${managed.runId},${nonce})`;
    const authorId = randomUUID(); const publicId = randomUUID(); const revokedId = randomUUID(); const afterBackupId = randomUUID(); const imageId = randomUUID();
    const password = "f2-synthetic-password-only"; const salt = "f2-synthetic-salt";
    const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("base64url")}`;
    await source.sql`insert into users (id,freq_code,frequency_name,password_hash,is_guest) values (${authorId},'FM 98.76','F2 synthetic',${passwordHash},false)`;
    await source.sql`insert into frequencies (id,code,frequency_name,password_hash,is_guest,created_at,updated_at)
      select id,freq_code,frequency_name,password_hash,is_guest,created_at,updated_at from users where id=${authorId}`;
    // Empty labels and no band are valid confirmed public content. Exercise
    // these query fallbacks instead of silently assuming every row has labels.
    const content = { expandedText: fixtureExpansion.expandedText, authorFreqCode: "FM 98.76", tags: [] as string[] };
    const snapshot = { kind: "AUTHOR_CONFIRMED", confirmedAt: new Date().toISOString(), content, digest: digestPublicationContent(content) };
    const vector = `[${[1, ...Array<number>(1023).fill(0)].join(",")}]`;
    const program = buildMinimalSignalProgram({ rawInput: fixtureSeed, expandedText: fixtureExpansion.expandedText, fingerprint: fixtureFingerprint });
    for (const id of [publicId, revokedId]) {
      await source.sql`insert into signals (id,author_id,frequency_id,raw_input,seed_text,expanded_text,fingerprint_json,program_json,
        status,generation_status,publication_version,publication_snapshot,embedding,embedding_provider,embedding_model,embedding_version,embedding_dimensions)
        values (${id},${authorId},${authorId},${fixtureSeed},${fixtureSeed},${fixtureExpansion.expandedText},${JSON.stringify(fixtureFingerprint)}::jsonb,${JSON.stringify(program)}::jsonb,
        'PUBLISHED','COMPLETED',1,${JSON.stringify(snapshot)}::jsonb,${vector}::vector,'synthetic','f2-vector','v1',1024)`;
    }
    const audio = Buffer.from("ID3 F2 synthetic media bytes; no generated speech");
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NvIAAAAASUVORK5CYII=", "base64");
    await mkdir(join(directory, "source-media", "audio"), { recursive: true });
    await mkdir(join(directory, "source-media", "images"));
    await writeFile(join(directory, "source-media", "audio", "fixture.mp3"), audio);
    await writeFile(join(directory, "source-media", "images", "fixture.png"), image);
    await source.sql`update signals set audio_status='READY',audio_publication_version=1,audio_storage_key='fixture.mp3',audio_url=${`/api/signals/${publicId}/audio/main?v=1`} where id=${publicId}`;
    await source.sql`insert into images (id,uploader_id,storage_key,mime_type,size_bytes) values (${imageId},${authorId},'fixture.png','image/png',${image.length})`;
    const configuration = { providerSecret: "f2-synthetic-encryption-secret-not-for-production", sessionSecret: "f2-synthetic-session-secret-not-for-production" };
    const apiKey = "f2-synthetic-provider-key-only"; const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(configuration.providerSecret).digest(), iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    const ciphertext = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
    await source.sql`insert into provider_configs (kind,provider,model,base_url,api_key_ciphertext,is_enabled,updated_by)
      values ('chat','synthetic','f2-model','http://127.0.0.1:9/v1',${ciphertext},true,${authorId})`;
    await writeFile(join(directory, "synthetic-config.json"), JSON.stringify(configuration), { mode: 0o600, flag: "wx" });
    events.checkpointAt = new Date().toISOString();
    const backupStartedAt = Date.now();
    await runShell(["scripts/deployment-stack.sh", "server", "backup"], stackEnvironment(sourceName));
    const backupFinishedAt = Date.now();
    // Exercise exactly the manual tar/copy steps documented for media/config.
    await runShell(["-c", 'umask 077; tar -czf "$1" -C "$2" .', "f2-media-backup", rel("media.tar.gz"), rel("source-media")]);
    await copyFile(join(directory, "synthetic-config.json"), join(directory, "config-backup.json"));
    const backupBytes = await readFile(join(directory, "checkpoint.sql.gz"));
    events.artifacts = { sqlSha256: sha(backupBytes), mediaSha256: sha(await readFile(join(directory, "media.tar.gz"))), configurationSha256: sha(await readFile(join(directory, "config-backup.json"))) };
    await runShell(["scripts/deployment-stack.sh", "server", "backup"], stackEnvironment(sourceName), false);
    expect(sha(await readFile(join(directory, "checkpoint.sql.gz")))).toBe(sha(backupBytes));
    const linuxPermissions = await runProcess("docker", ["compose", "--project-name", project, "--file", join(root, "tests/integration/compose.yaml"),
      "--env-file", join(runDirectory, "empty.env"), "exec", "-T", "postgres", "sh", "-c",
      (await readFile(join(root, "tests/integration/f2-linux-backup-permissions.sh"), "utf8")).replaceAll("\r\n", "\n"),
      "f2-linux-permissions", sourceName, nonce.replaceAll("-", "")], {}, true,
    (await readFile(join(root, "scripts/deployment-stack.sh"), "utf8")).replaceAll("\r\n", "\n"));
    const permissionEvidence: unknown = JSON.parse(linuxPermissions);
    expect(permissionEvidence).toMatchObject({ passed: true, rootMode: "700", temporaryDirectoryMode: "700", temporaryFileMode: "600", backupMode: "600", cleaned: true });
    events.linuxBackupPermissions = permissionEvidence;
    const newerAt = new Date();
    // Drizzle's migrator adjusted this client's serializers. Raw SQL therefore
    // supplies explicit wire text for timestamps, just as for JSONB above.
    await source.sql`update signals set status='DRAFT',publication_version=2,withdrawn_at=${newerAt.toISOString()}::timestamptz where id=${revokedId}`;
    await source.sql`insert into signals (id,raw_input,seed_text,expanded_text,fingerprint_json,program_json) values (${afterBackupId},'synthetic after checkpoint','synthetic after checkpoint','synthetic after checkpoint','{}','{}')`;
    // This file is a separately captured, authoritative synthetic change. A
    // stale backup alone cannot supply newer withdrawal/deletion decisions.
    await writeFile(join(directory, "newer-visibility.json"), JSON.stringify({ signalId: revokedId, status: "DRAFT", version: 2, withdrawnAt: newerAt.toISOString() }), { mode: 0o600, flag: "wx" });
    const recoveryStartedAt = Date.now();
    await writeFile(join(directory, "corrupt.sql.gz"), backupBytes.subarray(0, Math.max(1, backupBytes.length - 20)));
    await runShell(["scripts/deployment-stack.sh", "server", "restore"], { ...stackEnvironment(targetName), UNFREQ_BACKUP_FILE: rel("corrupt.sql.gz") }, false);
    expect((await target.sql`select tablename from pg_tables where schemaname in ('public','drizzle')`).length).toBe(0);
    await writeFile(join(directory, "invalid.sql"), "CREATE TABLE f2_rollback_probe(id integer);\nSELECT f2_missing_function();\n", { mode: 0o600 });
    await runShell(["scripts/deployment-stack.sh", "server", "restore"], { ...stackEnvironment(targetName), UNFREQ_BACKUP_FILE: rel("invalid.sql") }, false);
    expect((await target.sql`select tablename from pg_tables where schemaname='public'`).length).toBe(0);
    await writeFile(join(directory, "benign.sql"), "SELECT 1;\n", { mode: 0o600 });
    await target.sql`create schema pgcustom`;
    await runShell(["scripts/deployment-stack.sh", "server", "restore"], { ...stackEnvironment(targetName), UNFREQ_BACKUP_FILE: rel("benign.sql") }, false);
    expect((await target.sql`select nspname from pg_namespace where nspname='pgcustom'`).length).toBe(1);
    await target.sql`drop schema pgcustom`;
    const sqlRestoreStartedAt = Date.now();
    await runShell(["scripts/deployment-stack.sh", "server", "restore"], stackEnvironment(targetName));
    events.sqlRestoreMs = Date.now() - sqlRestoreStartedAt;
    // A SELECT-only input would succeed on an existing schema without the
    // restore guard; rejection cannot be explained by duplicate CREATE TABLE.
    await runShell(["scripts/deployment-stack.sh", "server", "restore"], { ...stackEnvironment(targetName), UNFREQ_BACKUP_FILE: rel("benign.sql") }, false);
    expect((await target.sql`select nonce from f2_recovery_ownership where run_id=${managed.runId}`)[0]?.nonce).toBe(nonce);
    expect((await target.sql`select id from signals where id=${afterBackupId}`).length).toBe(0);
    expect((await target.sql`select status from signals where id=${revokedId}`)[0]?.status).toBe("PUBLISHED");
    const currentVisibility = JSON.parse(await readFile(join(directory, "newer-visibility.json"), "utf8")) as { signalId: string; status: string; version: number; withdrawnAt: string };
    expect(currentVisibility.signalId).toBe(revokedId);
    await target.sql`update signals set status='DRAFT',publication_version=${currentVisibility.version},withdrawn_at=${currentVisibility.withdrawnAt}::timestamptz where id=${revokedId} and publication_version<${currentVisibility.version}`;
    await mkdir(join(directory, "restored-media"));
    await runShell(["-c", 'tar -xzf "$1" -C "$2"', "f2-media-restore", rel("media.tar.gz"), rel("restored-media")]);
    await copyFile(join(directory, "config-backup.json"), join(directory, "restored-config.json"));
    expect(await readFile(join(directory, "restored-media", "audio", "fixture.mp3"))).toEqual(audio);
    expect(await readFile(join(directory, "restored-media", "images", "fixture.png"))).toEqual(image);
    const restoredConfig = JSON.parse(await readFile(join(directory, "restored-config.json"), "utf8")) as typeof configuration;
    expect(restoredConfig).toEqual(configuration);
    const [extension] = await target.sql`select extversion from pg_extension where extname='vector'`;
    expect(extension?.extversion).toBeTruthy();
    const [nearest] = await target.sql`select id,(embedding <=> ${vector}::vector) as distance from signals where status='PUBLISHED' and withdrawn_at is null order by embedding <=> ${vector}::vector limit 1`;
    expect(nearest?.id).toBe(publicId); expect(Number(nearest?.distance)).toBeCloseTo(0);
    restoreEnvironment = await configureIsolatedEnvironment({ ...managed, databaseUrl: target.url });
    Object.assign(process.env, { SESSION_SECRET: restoredConfig.sessionSecret, PROVIDER_CONFIG_SECRET: restoredConfig.providerSecret,
      TTS_STORAGE_DIR: join(directory, "restored-media", "audio"), IMAGE_STORAGE_DIR: join(directory, "restored-media", "images") });
    restoreFetch = installFetchBoundary();
    const appModule = await import(/* @vite-ignore */ pathToFileURL(join(runtime.runtimeDirectory, "apps/api/src/app.js")).href) as typeof import("../../src/app.js");
    app = await appModule.buildApp({ logger: false });
    const apiFailures: Array<Record<string, unknown>> = []; events.apiFailures = apiFailures;
    app.addHook("onError", async (_request, _reply, error) => {
      const issues = (error as unknown as { issues?: Array<{ path?: unknown; code?: unknown }> }).issues;
      apiFailures.push({ type: error.name === "ZodError" ? "ZodError" : "Error",
        issues: Array.isArray(issues) ? issues.map((issue) => ({ code: typeof issue.code === "string" && /^[a-z_]+$/u.test(issue.code) ? issue.code : "unknown",
          path: Array.isArray(issue.path) ? issue.path.filter((part: unknown) => typeof part === "number" || typeof part === "string" && /^[a-zA-Z0-9_]+$/u.test(part)).join(".") : "unknown" })) : [],
      });
    });
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/health/deep" })).statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/api/auth/frequency/login", payload: { frequencyCode: "FM 98.76", password } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    expect(cookie).toContain("unfreq_session=");
    const history = await app.inject({ method: "GET", url: "/api/me/signals", headers: { cookie } });
    expect(history.statusCode).toBe(200);
    for (const id of [publicId, revokedId]) {
      expect(history.body).toContain(id);
      const ownerRead = await app.inject({ method: "GET", url: `/api/signals/${id}`, headers: { cookie } });
      expect(ownerRead.statusCode, JSON.stringify(apiFailures)).toBe(200);
      const owner = ownerRead.json<{ data: { signal: { rawInput: string; seedText: string; expandedText: string; publication: { state: string } } } }>().data.signal;
      expect(owner.rawInput).toBe(fixtureSeed); expect(owner.seedText).toBe(fixtureSeed); expect(owner.expandedText).toBe(fixtureExpansion.expandedText);
      if (id === revokedId) expect(owner.publication.state).toBe("WITHDRAWN");
    }
    const publicRead = await app.inject({ method: "GET", url: `/api/signals/${publicId}` });
    expect(publicRead.statusCode).toBe(200); expect(publicRead.body).not.toContain(fixtureSeed);
    expect((await app.inject({ method: "GET", url: `/api/signals/${revokedId}` })).statusCode).toBe(404);
    const audioRead = await app.inject({ method: "GET", url: `/api/signals/${publicId}/audio/main?v=1` });
    expect(audioRead.statusCode).toBe(200); expect(audioRead.rawPayload).toEqual(audio);
    const imageRead = await app.inject({ method: "GET", url: `/api/images/${imageId}` });
    expect(imageRead.statusCode).toBe(200); expect(imageRead.rawPayload).toEqual(image);
    const providerConfig = await import(/* @vite-ignore */ pathToFileURL(join(runtime.runtimeDirectory, "apps/api/src/modules/ai/provider-config.js")).href) as typeof import("../../src/modules/ai/provider-config.js");
    expect((await providerConfig.resolveChatProviderConfig()).apiKey).toBe(apiKey);
    expect(restoreFetch.blockedRequests).toEqual([]);
    Object.assign(events, { backupMs: backupFinishedAt - backupStartedAt, recoveryMs: Date.now() - recoveryStartedAt,
      rpoObservation: { checkpointRowsRestored: 2, postCheckpointRowsMissing: 1, newerVisibilityReplayed: 1,
        backupStartedAt: new Date(backupStartedAt).toISOString(), backupFinishedAt: new Date(backupFinishedAt).toISOString(), sourceNewerWriteAt: newerAt.toISOString(), exactSnapshotTimeKnown: false },
      checks: ["no-overwrite", "corrupt-gzip-no-write", "sql-error-rollback", "nonempty-target-denied", "pgvector-query", "config-decryption", "password-login", "private-history", "public-whitelist", "withdrawal-reconciliation", "audio-bytes", "image-bytes", "no-provider-dispatch"], passed: true });
  } catch (error) { failure = error; events.passed = false; }
  finally {
    if (app) try { await app.close(); } catch (error) { cleanupErrors.push(error); }
    if (restoreFetch) { if (restoreFetch.blockedRequests.length > 0) cleanupErrors.push(new Error("Recovery attempted an outbound HTTP call.")); restoreFetch(); }
    if (restoreEnvironment) try { await restoreEnvironment(); } catch (error) { cleanupErrors.push(error); }
    for (const sql of connections) try { await sql.end({ timeout: 2 }); } catch (error) { cleanupErrors.push(error); }
    for (const name of owned) {
      if (!/^unfreq_integration_f2_[a-f0-9]{12}_(source|target)$/u.test(name)) { cleanupErrors.push(new Error("Unowned database cleanup denied.")); continue; }
      try { await admin`drop database ${admin(name)} with (force)`; } catch (error) { cleanupErrors.push(error); }
    }
    try { await admin.end({ timeout: 2 }); } catch (error) { cleanupErrors.push(error); }
    Object.assign(events, { finishedAt: new Date().toISOString(), databasesCleaned: cleanupErrors.length === 0 });
    await writeFile(join(directory, "recovery-report.json"), `${JSON.stringify(events, null, 2)}\n`);
  }
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Recovery drill cleanup failed.");
}, 120_000);
