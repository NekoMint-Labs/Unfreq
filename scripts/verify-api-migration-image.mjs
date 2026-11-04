import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// This deliberately small verifier has no F4 builder/resume dependencies.
const root = fileURLToPath(new URL("../", import.meta.url));
const runId = randomBytes(12).toString("hex");
const prefix = `unfreq-migrate-${runId}`;
const label = "com.unfreq.migration-image-run";
const image = `${prefix}:candidate`;
const network = `${prefix}-network`;
const evidence = path.join(root, "test-results/runtime-migration-image", runId);
await mkdir(evidence, { recursive: true });
const report = { runId, passed: false, checks: [], cleanupErrors: [], cleaned: false };
const containers = [];
let networkCreated = false;
let imageCreated = false;

function run(command, args, { timeout = 60_000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout,
    windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (!allowFailure) {
    if (result.status !== 0 || result.error) appendFileSync(path.join(evidence, "failed-command.log"), `${command} ${args[0]}\n${result.stdout ?? ""}${result.stderr ?? ""}\n`);
    assert.equal(result.error, undefined, `${command} could not finish.`);
    assert.equal(result.signal, null, `${command} was terminated.`);
    assert.equal(result.status, 0, `${command} ${args[0]} failed.`);
  }
  return result;
}
const docker = (args, options) => run("docker", args, options);
const check = (name) => { report.checks.push(name); console.log(`Passed: ${name}`); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonDocker = (args) => JSON.parse(docker(args).stdout);
async function waitFor(checker, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (checker()) return;
    assert.ok(Date.now() < deadline, "An isolated service failed to become ready.");
    await delay(250);
  }
}
function create(role, serviceImage, options = [], command = [], start = true) {
  const name = `${prefix}-${role}`;
  const id = docker([start ? "run" : "create", ...(start ? ["--detach"] : []), "--name", name, "--label", `${label}=${runId}`,
    "--network", network, "--network-alias", role, ...options, serviceImage, ...command]).stdout.trim();
  assert.match(id, /^[a-f0-9]{64}$/u);
  containers.push(id);
  return id;
}
function inspect(id) {
  const [value] = jsonDocker(["container", "inspect", id]);
  assert.equal(value.Config.Labels[label], runId);
  assert.ok(value.Name.startsWith(`/${prefix}-`));
  return value;
}
const exec = (id, args, options) => docker(["exec", id, ...args], options);
const probe = (id, source, options) => exec(id, ["node", "--input-type=module", "-e", source], options);
const apiReady = (id) => probe(id, "const r=await fetch('http://127.0.0.1:4000/health',{signal:AbortSignal.timeout(1000)});if(r.status!==200)process.exit(1);", { allowFailure: true }).status === 0;
const ownedPaths = run("git", ["ls-files", "--cached", "-z"]).stdout.split("\0").filter((name) =>
  [".dockerignore", "Dockerfile.api", "package.json", "package-lock.json", "apps/web/package.json",
    "scripts/apply-postgres-lifecycle-patch.mjs", "scripts/api-entrypoint.sh",
    "scripts/verify-api-migration-image.mjs"].includes(name) || /^(apps\/api\/|packages\/contracts\/|patches\/)/u.test(name) ||
  /^tests\/images\/api-image-(active-shutdown|held-provider|active-probe)\.mjs$/u.test(name)).sort();
const hashes = async () => Object.fromEntries(await Promise.all(ownedPaths.map(async (name) => {
  const filename = path.join(root, name);
  const info = await lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  return [name, hash(await readFile(filename))];
})));
const inputs = await hashes();
report.sourceCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();
report.sourceTreeSha256 = hash(JSON.stringify(inputs));
await writeFile(path.join(evidence, "inputs.json"), JSON.stringify(inputs, null, 2) + "\n");

try {
  assert.equal(process.platform, "linux", "This verification requires a Linux Docker host.");
  const migrationFolder = path.join(root, "apps/api/src/db/migrations");
  const journal = JSON.parse(await readFile(path.join(migrationFolder, "meta/_journal.json"), "utf8"));
  assert.deepEqual({ ...journal, entries: [] }, { version: "7", dialect: "postgresql", entries: [] });
  assert.equal(journal.entries.length, 26, "The release candidate must contain exactly the original 24 migrations, C1 and scheduler.");
  // Pin the original main e5b459c entries/SQL and the exact C1 388bc5c append.
  // Git stores LF; source provenance tolerates only checkout CRLF conversion.
  // The real ledger hash below still uses the actual SQL bytes read by Drizzle.
  assert.equal(hash(JSON.stringify(journal.entries.slice(0, 24))), "cde2e7f2a9c908009d98c12b5df4e030896ce8e142ab124044b3f2a90e33bd28");
  assert.deepEqual(journal.entries[24], { idx: 24, version: "7", when: 1793221491240,
    tag: "0024_c1_publication_foundation", breakpoints: true });
  const migrations = await Promise.all(journal.entries.map(async ({ tag, when }) => {
    assert.match(tag, /^[a-zA-Z0-9_-]+$/u);
    const sql = await readFile(path.join(migrationFolder, tag + ".sql"));
    return { tag, when, hash: hash(sql), sourceHash: hash(sql.toString("utf8").replaceAll("\r\n", "\n")) };
  }));
  const sourceManifest = migrations.map(({ tag, when, sourceHash }) => ({ tag, when, hash: sourceHash }));
  assert.equal(hash(JSON.stringify(sourceManifest.slice(0, 24))), "556cec334a4260908800a878a46b1d6470690b329bf4970849e6c59fb785c43e");
  assert.equal(migrations[24].sourceHash, "9405d5d05704875af7e9cdd5df5db9234a8f5c3422ab2661c4da48a0b0e3d021");
  const expectedLedger = migrations.map(({ hash, when }) => ({ hash, createdAt: when }));

  assert.deepEqual(journal.entries[25], { idx: 25, version: "7", when: 1793810572548,
    tag: "0025_f1_ai_signal_scheduler", breakpoints: true });
  assert.equal(migrations[25].sourceHash, "95709799272eeaeda66c6fba4d41b0a297080ce5ab6dd5775f94cd4a5a892a86");
  report.migrations = { count: expectedLedger.length, sourceManifestSha256: hash(JSON.stringify(sourceManifest)) };
  const build = docker(["build", "--platform", "linux/amd64", "--file", "Dockerfile.api", "--target", "runner",
    "--label", `${label}=${runId}`, "--label", `org.opencontainers.image.revision=${report.sourceCommit}`,
    "--label", `com.unfreq.migration-source=${report.sourceTreeSha256}`, "--tag", image, "."], { timeout: 900_000, allowFailure: true });
  await writeFile(path.join(evidence, "build.log"), build.stdout + build.stderr);
  assert.equal(build.error, undefined, "The actual API image build did not finish.");
  assert.equal(build.status, 0, "The actual API image build failed; see the saved log.");
  imageCreated = true;
  const [built] = jsonDocker(["image", "inspect", image]);
  assert.equal(built.Config.Labels[label], runId);
  assert.equal(built.Config.Labels["org.opencontainers.image.revision"], report.sourceCommit);
  assert.equal(built.Config.Labels["com.unfreq.migration-source"], report.sourceTreeSha256);
  assert.equal(built.Os, "linux"); assert.equal(built.Architecture, "amd64");
  report.imageId = built.Id;
  check("real Dockerfile.api runner built with the frozen source identity");
  docker(["network", "create", "--internal", "--label", `${label}=${runId}`, network]);
  networkCreated = true;
  const password = randomBytes(24).toString("hex");
  const pg = create("postgres", "pgvector/pgvector:pg17", ["--tmpfs", "/var/lib/postgresql/data", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=unfreq_image"]);
  const redis = create("redis", "redis:7-alpine", ["--tmpfs", "/data"]);
  await waitFor(() => exec(pg, ["pg_isready", "-U", "postgres", "-d", "unfreq_image"], { allowFailure: true }).status === 0);
  await waitFor(() => exec(redis, ["redis-cli", "ping"], { allowFailure: true }).stdout.trim() === "PONG");
  const ruleNames = ["registerIp", "registerSite", "passwordRequestIp", "passwordRequestSite", "passwordFailureIp", "passwordFailureIdentityIp", "emailRequestIp", "emailRequestSite", "emailVerifyIp", "emailVerifySite", "generationRequestUser", "generationDailyUser", "generationDailySite", "audioReadIp", "audioRequestIp", "audioNewIp", "audioNewDailySite", "diagnosticIp", "diagnosticSite", "chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite", "reportRequestUser", "reportRequestIp", "reportReadUser"];
  const paid = new Set(["embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"]);
  const policy = { namespace: `migration-${runId}`, budgets: Object.fromEntries(ruleNames.map((name) => [name, { limit: paid.has(name) ? 0 : 100, windowMs: 60_000 }])), pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000 };
  const env = { NODE_ENV: "production", API_HOST: "0.0.0.0", API_PORT: "4000", WEB_ORIGIN: "https://migration-image.example",
    DATABASE_URL: `postgres://postgres:${password}@postgres:5432/unfreq_image`, REDIS_URL: "redis://redis:6379",
    SESSION_SECRET: randomBytes(32).toString("hex"), PROVIDER_CONFIG_SECRET: randomBytes(32).toString("hex"),
    AUTH_LOGIN_DELIVERY_MODE: "disabled", AUTH_LOGIN_CODE_RESPONSE: "disabled", ABUSE_PROTECTION_ENABLED: "true", ABUSE_LIMITS_JSON: JSON.stringify(policy),
    SIGNAL_GENERATION_WORKER_ENABLED: "false", AI_SIGNAL_SCHEDULER_ENABLED: "false",
    UNFREQ_IMAGE_VERIFICATION_RUN: runId,
    SIGNAL_GENERATION_SCAN_INTERVAL_MS: "100", DOTENV_CONFIG_QUIET: "true", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  const api = create("api", built.Id, Object.entries(env).flatMap(([name, value]) => ["--env", `${name}=${value}`]));
  await waitFor(() => apiReady(api));
  check("production entrypoint migrated a fresh database before serving HTTP");
  const packageProbe = probe(api, `import assert from 'node:assert/strict';import fs from 'node:fs';for(const name of ['drizzle-kit','@esbuild-kit/core-utils','@esbuild-kit/esm-loader']){assert.equal(fs.existsSync('/app/node_modules/'+name),false);}assert.equal(JSON.parse(fs.readFileSync('/app/node_modules/postgres/package.json')).version,'4.0.0');const command=fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean);assert.deepEqual(command,['node','dist/server.js']);console.log(JSON.stringify({driver:'4.0.0',pid1:command,developmentToolkitAbsent:true}));`);
  report.packages = JSON.parse(packageProbe.stdout);
  check("omit-dev runner excludes the toolkit and keeps postgres 4.0.0; Node is PID 1");
  const query = (sql) => exec(pg, ["psql", "-U", "postgres", "-d", "unfreq_image", "-At", "-c", sql]).stdout.trim();
  const ledgerSql = "select json_agg(t)::text from (select id,hash,created_at from drizzle.__drizzle_migrations order by id) t";
  const ledger = query(ledgerSql);
  assert.deepEqual(JSON.parse(ledger).map(({ hash, created_at }) => ({ hash, createdAt: created_at })), expectedLedger);
  const rerun = exec(api, ["npm", "run", "api:migrate"]);
  assert.match(rerun.stdout, /Database migrations completed\./u);
  assert.equal(query(ledgerSql), ledger);
  check("the bundled compiled CLI preserves every SQL hash and timestamp in the exact 26-entry scheduler ledger and is idempotent");
  const blank = docker(["exec", "--env", "DATABASE_URL=", api, "node", "apps/api/dist/scripts/migrate.js"], { allowFailure: true });
  assert.equal(blank.status, 1); assert.equal(blank.stdout, ""); assert.equal(blank.stderr, "Database migration failed.\n");
  check("the production CLI rejects an empty URL with bounded fixed failure output");
  docker(["stop", "--time", "15", api], { timeout: 20_000 });
  assert.equal(inspect(api).State.ExitCode, 0); assert.equal(inspect(api).State.OOMKilled, false);
  check("the production entrypoint completes an idle SIGTERM naturally");
  // Reuse the already defined #9 synthetic fixture and every one of its
  // shutdown, restart/control-task, no-replay and 25-second assertions.
  const verification = path.join(evidence, "verification/tests/images");
  await mkdir(verification, { recursive: true });
  for (const name of ["api-image-active-shutdown.mjs", "api-image-active-probe.mjs", "api-image-held-provider.mjs"]) {
    const bytes = await readFile(path.join(root, "tests/images", name));
    assert.equal(hash(bytes), inputs[`tests/images/${name}`]);
    await writeFile(path.join(verification, name), bytes, { flag: "wx" });
  }
  const { verifyActiveShutdown } = await import(pathToFileURL(path.join(verification, "api-image-active-shutdown.mjs")).href);
  report.activeShutdown = {};
  await verifyActiveShutdown({
    docker: (args, options = {}) => docker(args, { timeout: options.timeoutMs ?? 60_000 }),
    createContainer: create,
    untilReady: (id, args) => waitFor(() => exec(id, args, { allowFailure: true }).status === 0),
    inspectOwned: async (kind, id) => { assert.equal(kind, "container"); return inspect(id); },
    imageId: built.Id, apiEnv: env, policy, pg, directory: evidence, runId,
    record: report.activeShutdown,
    save: () => writeFile(path.join(evidence, "summary.json"), JSON.stringify(report, null, 2) + "\n"),
  });
  check("the original active-job fixture preserves clean SIGTERM, failed outcome, restart/control task and no replay within 25 seconds");
  assert.deepEqual(await hashes(), inputs);
  report.sourceVerified = true;
  check("all frozen build inputs remain unchanged through the real image verification");
  report.passed = true;
} catch (error) {
  report.failure = String(error?.message ?? error);
  console.error(report.failure);
} finally {
  for (const id of containers.reverse()) {
    try {
      const value = inspect(id);
      const logs = docker(["logs", id], { allowFailure: true });
      await writeFile(path.join(evidence, `${value.Name.slice(1)}.log`), logs.stdout + logs.stderr);
      if (value.State.Running) docker(["stop", "--time", "15", id], { timeout: 20_000 });
      docker(["container", "rm", "--volumes", id]);
    } catch { report.cleanupErrors.push("Owned container cleanup failed."); }
  }
  if (networkCreated) {
    try {
      const [value] = jsonDocker(["network", "inspect", network]); assert.equal(value.Labels[label], runId);
      docker(["network", "rm", network]);
    } catch { report.cleanupErrors.push("Owned network cleanup failed."); }
  }
  if (imageCreated) {
    try { const [value] = jsonDocker(["image", "inspect", image]); assert.equal(value.Config.Labels[label], runId); docker(["image", "rm", image]); }
    catch { report.cleanupErrors.push("Owned image cleanup failed."); }
  }
  const leftContainers = docker(["container", "ls", "--all", "--quiet", "--filter", `label=${label}=${runId}`], { allowFailure: true });
  const leftNetworks = docker(["network", "ls", "--quiet", "--filter", `label=${label}=${runId}`], { allowFailure: true });
  report.cleaned = report.cleanupErrors.length === 0 && leftContainers.status === 0 && leftNetworks.status === 0 && !leftContainers.stdout.trim() && !leftNetworks.stdout.trim();
  report.passed = report.passed && report.cleaned;
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, sourceVerified: report.sourceVerified ?? false, cleaned: report.cleaned, evidence }));
  if (!report.passed) process.exitCode = 1;
}
