import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { verifyIntegrationRuntime, type IntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";
import { assertManagedIntegrationEnvironment } from "./harness.js";

type Sql = ReturnType<typeof postgres>;
type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };
type ProcessResult = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; outputLimit: boolean; stdout: string; stderr: string };
type ControlledPgEnvironment = Readonly<Record<"PGHOST" | "PGPORT" | "PGUSER" | "PGPASSWORD" | "PGDATABASE", string>>;
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const payloadRelative = "apps/api/src/db/migrations";
const scriptRelative = "apps/api/src/scripts/migrate.js";
const ownedDatabases = new Set<string>();
let admin: Sql;
let runtime: IntegrationRuntime;
let directory: string;
let emptyEnv: string;
let journal: Journal;
let expectedLedger: Array<{ hash: string; created_at: string }>;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

beforeAll(async () => {
  const managed = assertManagedIntegrationEnvironment();
  runtime = await verifyIntegrationRuntime({ repositoryRoot: root, runId: managed.runId,
    runtimeDirectory: process.env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "", ownershipToken: process.env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "" });
  directory = join(runtime.runDirectory, "migration-cli");
  await mkdir(directory); // Never adopt a previous case or shared dist output.
  emptyEnv = join(directory, "empty.env");
  await writeFile(emptyEnv, "# Deliberately empty migration CLI test environment.\n", { flag: "wx" });
  journal = JSON.parse(await readFile(join(runtime.runtimeDirectory, payloadRelative, "meta/_journal.json"), "utf8")) as Journal;
  expect({ ...journal, entries: [] }).toEqual({ version: "7", dialect: "postgresql", entries: [] });
  expect(journal.entries).toHaveLength(25);
  // Main e5b459c owns the original 24 entries/SQL; C1 388bc5c owns the only append.
  expect(hash(JSON.stringify(journal.entries.slice(0, 24)))).toBe("cde2e7f2a9c908009d98c12b5df4e030896ce8e142ab124044b3f2a90e33bd28");
  expect(journal.entries[24]).toEqual({ idx: 24, version: "7", when: 1793221491240,
    tag: "0024_c1_publication_foundation", breakpoints: true });
  const migrations = await Promise.all(journal.entries.map(async ({ tag, when }) => {
    expect(tag).toMatch(/^[a-zA-Z0-9_-]+$/u);
    const sql = await readFile(join(runtime.runtimeDirectory, payloadRelative, tag + ".sql"));
    // Git LF pins admit checkout CRLF only. Ledger expectations retain raw SQL
    // bytes so the same test observes the actual Windows or Linux migrator hash.
    return { tag, when, hash: hash(sql), sourceHash: hash(sql.toString("utf8").replaceAll("\r\n", "\n")) };
  }));
  const sourceManifest = migrations.map(({ tag, when, sourceHash }) => ({ tag, when, hash: sourceHash }));
  expect(hash(JSON.stringify(sourceManifest.slice(0, 24)))).toBe("556cec334a4260908800a878a46b1d6470690b329bf4970849e6c59fb785c43e");
  expect(migrations[24]!.sourceHash).toBe("9405d5d05704875af7e9cdd5df5db9234a8f5c3422ab2661c4da48a0b0e3d021");
  expectedLedger = migrations.map(({ hash, when }) => ({ hash, created_at: String(when) }));
  admin = postgres(managed.databaseUrl, { infer: true, max: 1, prepare: false, connect_timeout: 3, onnotice: false });
});

async function dropOwnedDatabase(name: string) {
  const managed = assertManagedIntegrationEnvironment();
  if (!ownedDatabases.has(name) || !name.startsWith(`unfreq_it_migrate_${managed.runId}_`) || !/^[a-z0-9_]+$/u.test(name)) {
    throw new Error("Refusing an unowned migration test database.");
  }
  await admin.unsafe(`drop database "${name}" with (force)`);
  ownedDatabases.delete(name);
}

afterAll(async () => {
  const cleanupErrors: string[] = [];
  try {
    for (const name of ownedDatabases) {
      try { await dropOwnedDatabase(name); } catch { cleanupErrors.push("Owned migration test database cleanup failed."); }
    }
  } finally {
    await admin?.end({ timeout: 0 });
  }
  expect(cleanupErrors).toEqual([]);
});

async function withDatabase(work: (url: string, sql: Sql) => Promise<void>) {
  const managed = assertManagedIntegrationEnvironment();
  const name = `unfreq_it_migrate_${managed.runId}_${randomBytes(6).toString("hex")}`;
  if (!/^[a-z0-9_]{1,63}$/u.test(name)) throw new Error("Unexpected synthetic database name.");
  await admin.unsafe(`create database "${name}"`);
  ownedDatabases.add(name);
  const url = new URL(managed.databaseUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { infer: true, max: 1, prepare: false, connect_timeout: 3, onnotice: false });
  try { await work(url.toString(), sql); }
  finally {
    await sql.end({ timeout: 0 });
    await dropOwnedDatabase(name);
  }
}

async function runCli(databaseUrl: string, script = join(runtime.runtimeDirectory, scriptRelative), controlledPg?: ControlledPgEnvironment, args: string[] = []): Promise<ProcessResult> {
  const managed = assertManagedIntegrationEnvironment();
  await verifyIntegrationRuntime({ repositoryRoot: root, runId: managed.runId,
    runtimeDirectory: runtime.runtimeDirectory, ownershipToken: runtime.ownershipToken });
  const systemKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key.toUpperCase())));
  Object.assign(env, { NODE_ENV: "test", DATABASE_URL: databaseUrl, DOTENV_CONFIG_PATH: emptyEnv, DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_OVERRIDE: "false" });
  if (controlledPg) {
    const target = new URL(managed.databaseUrl);
    if (controlledPg.PGHOST !== target.hostname || controlledPg.PGPORT !== target.port ||
        controlledPg.PGUSER !== target.username || controlledPg.PGPASSWORD !== target.password ||
        !ownedDatabases.has(controlledPg.PGDATABASE)) {
      throw new Error("Migration fallback environment must target an owned test database.");
    }
    for (const key of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const) env[key] = controlledPg[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: directory, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let bytes = 0; let timedOut = false; let outputLimit = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
      bytes += chunk.length;
      if (bytes > 65_536) { outputLimit = true; child.kill("SIGKILL"); return; }
      if (stream === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    child.once("error", () => { clearTimeout(timer); reject(new Error("Managed migration process failed to start.")); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, outputLimit, stdout, stderr });
    });
  });
}

function expectOutcome(result: ProcessResult, success: boolean) {
  // A killed child is a failing test, never proof of natural migration failure.
  expect(result.timedOut).toBe(false);
  expect(result.outputLimit).toBe(false);
  expect(result.signal).toBeNull();
  expect(result.code).toBe(success ? 0 : 1);
  expect(result.stdout).toBe(success ? "Database migrations completed.\n" : "");
  expect(result.stderr).toBe(success ? "" : "Database migration failed.\n");
}

async function ledger(sql: Sql) {
  const rows = [...await sql`select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id`];
  expect(rows.map(({ hash, created_at }) => ({ hash, created_at }))).toEqual(expectedLedger);
  return rows;
}

it("runs the compiled CLI on an empty database and preserves the same ledger on a second run", async () => {
  await withDatabase(async (url, sql) => {
    expectOutcome(await runCli(url), true);
    const first = await ledger(sql);
    expect(first).toHaveLength(25);
    const [tables] = await sql`select to_regclass('public.users')::text as users, to_regclass('public.signals')::text as signals`;
    expect(tables).toEqual({ users: "users", signals: "signals" });
    expectOutcome(await runCli(url), true);
    expect(await ledger(sql)).toEqual(first);
  });
});

it("rolls pending DDL, data and ledger entries back together when a private copied payload fails", async () => {
  await withDatabase(async (url, sql) => {
    expectOutcome(await runCli(url), true);
    const before = await ledger(sql);
    await sql`create table migration_cli_existing_state (id integer primary key, value text not null)`;
    await sql`insert into migration_cli_existing_state values (1, 'before')`;
    await sql`create sequence migration_cli_progress_seq`;
    const privateRoot = join(directory, `fault-${randomBytes(6).toString("hex")}`);
    const privateScript = join(privateRoot, scriptRelative);
    const payload = join(privateRoot, payloadRelative);
    await mkdir(join(payload, "meta"), { recursive: true });
    await mkdir(join(privateRoot, "apps/api/src/scripts"), { recursive: true });
    await copyFile(join(runtime.runtimeDirectory, "package.json"), join(privateRoot, "package.json"), constants.COPYFILE_EXCL);
    await copyFile(join(runtime.runtimeDirectory, scriptRelative), privateScript, constants.COPYFILE_EXCL);
    for (const entry of journal.entries) {
      await copyFile(join(runtime.runtimeDirectory, payloadRelative, `${entry.tag}.sql`), join(payload, `${entry.tag}.sql`), constants.COPYFILE_EXCL);
    }
    const last = journal.entries.at(-1)!;
    const nextNumber = Number(last.tag.slice(0, 4)) + 1;
    const pending = ["before_failure", "failed_ddl"].map((suffix, index) =>
      `${String(nextNumber + index).padStart(4, "0")}_migration_cli_${suffix}`);
    expect(journal.entries.some(({ tag }) => pending.includes(tag))).toBe(false);
    const copiedJournal = { ...journal, entries: [...journal.entries, ...pending.map((tag, index) => ({
      idx: journal.entries.length + index, version: last.version, when: last.when + index + 1, tag, breakpoints: true,
    }))] };
    await writeFile(join(payload, "meta/_journal.json"), JSON.stringify(copiedJournal), { flag: "wx" });
    await writeFile(join(payload, `${pending[0]}.sql`), [
      "select nextval('migration_cli_progress_seq');",
      "create table migration_cli_added_table (id integer primary key);",
      "update migration_cli_existing_state set value = 'changed' where id = 1;",
      "insert into migration_cli_existing_state values (2, 'added');",
    ].join("\n--> statement-breakpoint\n"), { flag: "wx" });
    const hiddenSql = `migration_cli_hidden_type_${randomBytes(5).toString("hex")}`;
    await writeFile(join(payload, `${pending[1]}.sql`), [
      "select nextval('migration_cli_progress_seq');",
      `create table migration_cli_broken_table (id ${hiddenSql});`,
    ].join("\n--> statement-breakpoint\n"), { flag: "wx" });
    const failed = await runCli(url, privateScript);
    expectOutcome(failed, false);
    expect(failed.stderr).not.toContain(url);
    expect(failed.stderr).not.toContain(hiddenSql);
    // Sequence increments survive transaction rollback. This proves both new
    // SQL files actually ran before the DDL error, rather than failing on a path.
    const [progress] = await sql`select last_value::int as value from migration_cli_progress_seq`;
    expect(progress.value).toBe(2);
    expect([...await sql`select id, value from migration_cli_existing_state order by id`]).toEqual([{ id: 1, value: "before" }]);
    const [tables] = await sql`select to_regclass('public.migration_cli_added_table') as added, to_regclass('public.migration_cli_broken_table') as broken`;
    expect(tables).toEqual({ added: null, broken: null });
    expect(await ledger(sql)).toEqual(before);
  });
});

it("fails naturally on an unavailable loopback database with fixed output and no URL, SQL or success text", async () => {
  const managed = assertManagedIntegrationEnvironment();
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  expect(port).toBeGreaterThanOrEqual(1024);
  const url = new URL(managed.databaseUrl);
  url.port = String(port);
  url.username = "migration_cli_hidden_user";
  url.password = "migration_cli_hidden_password";
  const failed = await runCli(url.toString());
  expectOutcome(failed, false);
  for (const hidden of [url.toString(), url.username, url.password, "CREATE TABLE", "Database migrations completed."]) {
    expect(failed.stdout + failed.stderr).not.toContain(hidden);
  }
});

it("rejects empty and whitespace URLs before migrating a reachable PG environment fallback database", async () => {
  await withDatabase(async (url, sql) => {
    const target = new URL(url);
    const controlledPg: ControlledPgEnvironment = {
      PGHOST: target.hostname, PGPORT: target.port, PGUSER: target.username,
      PGPASSWORD: target.password, PGDATABASE: target.pathname.slice(1),
    };
    const expectUntouched = async () => {
      const [state] = await sql`select to_regnamespace('drizzle')::text as ledger_schema, to_regclass('public.users')::text as users`;
      expect(state).toEqual({ ledger_schema: null, users: null });
    };
    // The control connection proves this exact isolated target is reachable.
    // If an empty URL were allowed through, these PG* values could migrate it.
    await expectUntouched();
    for (const supplied of ["", " \t"]) {
      const failed = await runCli(supplied, undefined, controlledPg);
      expectOutcome(failed, false);
      await expectUntouched();
    }
  });
});


it("preserves the existing toolkit ledger in both toolkit-to-runner and runner-to-toolkit order", async () => {
  const toolkit = fileURLToPath(new URL("../../../../node_modules/drizzle-kit/bin.cjs", import.meta.url));
  for (const toolkitFirst of [true, false]) {
    await withDatabase(async (url, sql) => {
      const config = join(directory, `toolkit-${randomBytes(6).toString("hex")}.ts`);
      await writeFile(config, `export default ${JSON.stringify({ dialect: "postgresql",
        out: join(runtime.runtimeDirectory, payloadRelative), dbCredentials: { url } })};\n`, { flag: "wx" });
      const toolkitRun = async () => {
        const result = await runCli(url, toolkit, undefined, ["migrate", `--config=${config}`]);
        expect(result.timedOut).toBe(false);
        expect(result.outputLimit).toBe(false);
        expect(result.signal).toBeNull();
        expect(result.code).toBe(0);
      };
      if (toolkitFirst) await toolkitRun();
      else expectOutcome(await runCli(url), true);
      const original = await ledger(sql);
      expect(original).toHaveLength(25);
      if (toolkitFirst) expectOutcome(await runCli(url), true);
      else await toolkitRun();
      expect(await ledger(sql)).toEqual(original);
    });
  }
});
