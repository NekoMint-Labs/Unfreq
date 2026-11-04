import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe, expect, it } from "vitest";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";
import { assertManagedIntegrationEnvironment } from "./harness.js";
import { createProviderStub, type IntegrationProvider } from "./provider-stub.js";
import type { SchedulerCommand, SchedulerDiagnostics, SchedulerMessage } from "./f1-scheduler-process-fixture.js";

type Sql = ReturnType<typeof postgres>;
type CaseId = "parallel" | "calendar" | "crash" | "close" | "failure" | "budget" | "fence";
type DueResult = { status: string; businessDate?: string };
type Ledger = { status: string; business_date: string; requested_count: number; signal_budget: number; dispatch_budget: number; dispatch_count: number; accepted_count: number; result_signal_ids: string[]; first_dispatch_at: Date | null; failure_code: string | null };
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sleep = (ms: number) => new Promise<void>((yes) => setTimeout(yes, ms));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const emptyEnvironment = "# Owned F1 scheduler integration environment; no project dotenv.\n";

class SchedulerProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  readonly infrastructureErrors: string[] = [];
  private ended = false;
  private sequence = 0;
  private killing: Promise<void> | undefined;
  private pending = new Map<number, { yes: (value: unknown) => void; no: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(entry: string, environment: NodeJS.ProcessEnv, private events: Array<Record<string, unknown>>) {
    this.child = spawn(process.execPath, [entry], { cwd: root, env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    this.pid = this.child.pid ?? -1;
    let ready!: () => void; let reject!: (error: Error) => void; let closed!: () => void;
    this.ready = new Promise<void>((yes, no) => { ready = yes; reject = no; }); void this.ready.catch(() => {});
    this.closed = new Promise<void>((yes) => { closed = yes; });
    const startedAt = Date.now(); events.push({ event: "spawn", pid: this.pid, at: startedAt });
    let bytes = 0;
    const capture = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65_536) { this.infrastructureErrors.push("OUTPUT_LIMIT"); void this.kill().catch(() => {}); }
      // No arbitrary child logs are persisted; a leak still fails the case.
      if (["f1-scheduler-stub-only", "unfreq_integration_only", environment.SESSION_SECRET!, environment.PROVIDER_CONFIG_SECRET!].some((secret) => chunk.toString("utf8").includes(secret))) {
        this.infrastructureErrors.push("PRIVATE_LOG_MARKER");
      }
    };
    this.child.stdout?.on("data", capture); this.child.stderr?.on("data", capture);
    this.child.once("error", () => { this.infrastructureErrors.push("SPAWN_FAILED"); reject(new Error("F1 child spawn failed.")); });
    this.child.once("close", (code, signal) => {
      this.ended = true; events.push({ event: "close", pid: this.pid, code, signal, at: Date.now() }); closed();
      reject(new Error("F1 child closed before ready."));
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.no(new Error("F1 child closed during command.")); }
      this.pending.clear();
    });
    this.child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object" || !("kind" in raw)) return;
      const message = raw as SchedulerMessage;
      if (message.kind === "ready") {
        if (message.pid !== this.pid) { this.infrastructureErrors.push("PID_MISMATCH"); void this.kill().catch(() => {}); }
        else { events.push({ event: "ready", pid: this.pid, elapsedMs: Date.now() - startedAt }); ready(); }
      } else if (message.kind === "fatal") {
        this.infrastructureErrors.push("FIXTURE_FATAL"); reject(new Error("F1 child fixture failed.")); void this.kill().catch(() => {});
      } else if (message.kind === "reply") {
        const item = this.pending.get(message.id); if (!item) return;
        clearTimeout(item.timer); this.pending.delete(message.id);
        if (message.ok) item.yes(message.value); else item.no(new Error("F1 child command failed."));
      }
    });
  }
  get isClosed() { return this.ended; }
  async waitReady() {
    let timer: NodeJS.Timeout | undefined;
    try { await Promise.race([this.ready, new Promise<never>((_, no) => { timer = setTimeout(() => {
      this.infrastructureErrors.push("READY_TIMEOUT"); void this.kill().then(() => no(new Error("F1 child exceeded its original 20s cold-ready budget after termination.")), no);
    }, 20_000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  request<T>(command: SchedulerCommand, budget = 15_000): Promise<T> {
    if (this.ended || !this.child.connected) return Promise.reject(new Error("F1 child IPC is closed."));
    const id = ++this.sequence;
    return new Promise<T>((yes, no) => {
      const timer = setTimeout(() => { this.infrastructureErrors.push("COMMAND_TIMEOUT"); void this.kill().then(() => no(new Error("F1 command exceeded budget after terminating its PID.")), no); }, budget);
      this.pending.set(id, { yes: (value) => yes(value as T), no, timer });
      this.child.send({ id, command }, (error) => { if (error) void this.kill().then(() => no(new Error("F1 IPC send failed.")), no); });
    });
  }
  async kill() {
    if (this.ended) return;
    this.killing ??= (async () => {
      this.events.push({ event: "owned-kill", pid: this.pid, at: Date.now() }); this.child.kill("SIGKILL");
      await bounded(this.closed, 3_000, "F1 owned child failed to exit after SIGKILL.");
    })();
    return this.killing;
  }
  async stop() {
    if (this.ended) return;
    const diagnostics = await this.request<SchedulerDiagnostics>({ kind: "shutdown" }, 10_000);
    await bounded(this.closed, 3_000, "F1 app.close left its child alive.");
    expect(diagnostics).toMatchObject({ blockedHttp: 0, pendingHttp: 0, unhandled: 0 });
    expect(this.child.exitCode).toBe(0);
    return diagnostics;
  }
}

async function bounded<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([work, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(message)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function withCase(caseId: CaseId, work: (h: {
  sql: Sql; provider: IntegrationProvider; start: () => Promise<SchedulerProcess>; rows: () => Promise<Ledger[]>;
}) => Promise<void>) {
  const managed = assertManagedIntegrationEnvironment();
  const runtime = await verifyIntegrationRuntime({ repositoryRoot: root, runId: managed.runId, entry: "scheduler",
    runtimeDirectory: process.env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "", ownershipToken: process.env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "" });
  const nonce = randomUUID().replaceAll("-", "").slice(0, 24);
  const databaseName = `unfreq_integration_f1_${hash(managed.runId).slice(0, 10)}_${caseId}_${nonce.slice(0, 8)}`;
  if (!/^unfreq_integration_f1_[a-f0-9]{10}_[a-z]{5,8}_[a-f0-9]{8}$/u.test(databaseName) || databaseName.length > 63) throw new Error("Invalid F1 case database.");
  const directory = await mkdtemp(join(tmpdir(), `unfreq-f1-${nonce}-`));
  const databaseUrl = new URL(managed.databaseUrl); databaseUrl.protocol = "postgres:"; databaseUrl.pathname = `/${databaseName}`;
  const events: Array<Record<string, unknown>> = [];
  const children: SchedulerProcess[] = [];
  let admin: Sql | undefined; let sql: Sql | undefined; let provider: IntegrationProvider | undefined;
  let created = false; let marked = false; let failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    await writeFile(join(directory, "empty.env"), emptyEnvironment);
    admin = postgres(managed.databaseUrl, { infer: true, max: 1, prepare: false, connect_timeout: 5, connection: { statement_timeout: 2500 } });
    const [identity] = await admin<{ database: string; owner: string }[]>`select current_database() as database, current_user as owner`;
    if (identity?.database !== "unfreq_integration" || identity.owner !== "unfreq_test" || (await admin`select datname from pg_database where datname = ${databaseName}`).length) throw new Error("F1 refuses an existing or foreign database.");
    await admin`create database ${admin(databaseName)}`; created = true;
    sql = postgres(databaseUrl.toString(), { infer: true, max: 1, prepare: false, connect_timeout: 5, connection: { statement_timeout: 2500 } });
    if ((await sql`select table_name from information_schema.tables where table_schema in ('public','drizzle')`).length) throw new Error("F1 requires a new empty database.");
    await sql`create table scheduler_test_ownership (run_id text not null, case_id text not null, nonce text primary key)`;
    await sql`insert into scheduler_test_ownership values (${managed.runId}, ${caseId}, ${nonce})`; marked = true;
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    provider = await createProviderStub();
    const readySql = sql; const readyProvider = provider;
    const allowedSystem = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE"]);
    const environment: NodeJS.ProcessEnv = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowedSystem.has(key.toUpperCase())).map(([key, value]) => [key.toUpperCase(), value])),
      NODE_ENV: "test", UNFREQ_INTEGRATION_MANAGED: "1", UNFREQ_INTEGRATION_RUN_ID: managed.runId,
      UNFREQ_INTEGRATION_RUNTIME_DIR: runtime.runtimeDirectory, UNFREQ_INTEGRATION_RUNTIME_TOKEN: runtime.ownershipToken,
      UNFREQ_F1_FIXTURE: "1", UNFREQ_F1_CASE: caseId, UNFREQ_F1_NONCE: nonce, UNFREQ_F1_PARENT_PID: String(process.pid),
      UNFREQ_F1_DIRECTORY: directory, UNFREQ_F1_PROVIDER_ORIGIN: readyProvider.origin,
      DATABASE_URL: databaseUrl.toString(), REDIS_URL: managed.redisUrl,
      DOTENV_CONFIG_PATH: join(directory, "empty.env"), DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_OVERRIDE: "false",
      AI_API_KEY: "f1-scheduler-stub-only", AI_BASE_URL: `${readyProvider.origin}/v1`, AI_PROVIDER: "integration-loopback", AI_MODEL: "synthetic-signal-v1",
      AI_FAST_API_KEY: "", AI_FAST_BASE_URL: "", AI_FAST_MODEL: "", AI_FAST_PROVIDER: "", AI_SIGNAL_SCHEDULER_ENABLED: "false",
      EMBEDDING_API_KEY: "", EMBEDDING_BASE_URL: "", EMBEDDING_PROVIDER: "disabled", EMBEDDING_MODEL: "disabled", EMBEDDING_DIMENSIONS: "1024", EMBEDDING_VERSION: "integration-v1",
      RERANKER_API_KEY: "", RERANKER_BASE_URL: "", RERANKER_PROVIDER: "disabled", RERANKER_MODEL: "disabled", RERANKER_SCORE_SCALE: "",
      TTS_API_KEY: "", TTS_BASE_URL: "", TTS_PROVIDER: "disabled", TTS_MODEL: "disabled", TTS_VOICE_LEFT: "integration", TTS_VOICE_RIGHT: "integration",
      TTS_STORAGE_DIR: join(directory, "audio"), IMAGE_STORAGE_DIR: join(directory, "images"), IMAGE_MAX_BYTES: "2097152",
      SESSION_SECRET: `f1-scheduler-session-${nonce}`, PROVIDER_CONFIG_SECRET: `f1-scheduler-provider-${nonce}`,
      AUTH_LOGIN_CODE_RESPONSE: "disabled", AUTH_LOGIN_DELIVERY_MODE: "disabled", AUTH_LOGIN_CHALLENGE_TTL_SECONDS: "600", AUTH_LOGIN_MAX_VERIFY_ATTEMPTS: "5", AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS: "1",
      WEB_ORIGIN: "http://127.0.0.1:3200", API_HOST: "127.0.0.1", API_PORT: "4000", HEALTH_DEPENDENCY_TIMEOUT_MS: "500", DB_POOL_MAX: "4", LOG_LEVEL: "error",
      SIGNAL_GENERATION_WORKER_ENABLED: "false",
    };
    await work({ sql: readySql, provider: readyProvider,
      async start() { const child = new SchedulerProcess(runtime.entryPath, environment, events); children.push(child); await child.waitReady(); return child; },
      rows: () => readySql<Ledger[]>`select status, business_date::text, requested_count, signal_budget, dispatch_budget, dispatch_count, accepted_count, result_signal_ids, first_dispatch_at, failure_code from ai_signal_scheduler_batches order by business_date`,
    });
  } catch (error) { failure = error; }
  finally {
    const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { cleanupErrors.push(error); } };
    provider?.releaseAll();
    for (const child of children) {
      if (!child.isClosed) await attempt(() => child.stop());
      if (!child.isClosed) await attempt(() => child.kill());
      if (child.infrastructureErrors.length) cleanupErrors.push(new Error(`F1 fixture infrastructure errors: ${child.infrastructureErrors.join(",")}`));
    }
    if (provider) {
      await attempt(() => provider!.close());
      if (provider.blockedRequests.length || provider.tasks.includes("unsupported") || provider.inFlight !== 0) cleanupErrors.push(new Error("F1 provider boundary or drain failed."));
    }
    let dropAllowed = false;
    if (created && admin) await attempt(async () => {
      const [owner] = await admin!<{ owner: string }[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${databaseName}`;
      if (owner?.owner !== "unfreq_test") throw new Error("Refusing F1 cleanup with changed database owner.");
      if (marked && sql) {
        const rows = await sql<{ run_id: string; case_id: string; nonce: string }[]>`select run_id, case_id, nonce from scheduler_test_ownership`;
        if (rows.length !== 1 || rows[0].run_id !== managed.runId || rows[0].case_id !== caseId || rows[0].nonce !== nonce) throw new Error("Refusing F1 cleanup with changed run marker.");
      }
      dropAllowed = true;
    });
    if (sql) await attempt(() => sql!.end({ timeout: 0 }));
    if (dropAllowed && admin) await attempt(async () => {
      const deadline = Date.now() + 2_000;
      while ((await admin!`select pid from pg_stat_activity where datname = ${databaseName}`).length && Date.now() < deadline) await sleep(25);
      if ((await admin!`select pid from pg_stat_activity where datname = ${databaseName}`).length) throw new Error("F1 database retained clients; refusing forced cleanup.");
      await admin!`drop database ${admin!(databaseName)}`;
      if ((await admin!`select datname from pg_database where datname = ${databaseName}`).length) throw new Error("F1 database remained after drop.");
    });
    if (admin) await attempt(() => admin!.end({ timeout: 0 }));
    await attempt(async () => {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(`unfreq-f1-${nonce}-`)) throw new Error("Refusing an unowned F1 directory cleanup.");
      await rm(target, { recursive: true, force: true });
    });
    await mkdir(join(root, "test-results/f1"), { recursive: true });
    await writeFile(join(root, "test-results/f1", `scheduler-${managed.runId}-${caseId}-${nonce.slice(0, 8)}.json`), `${JSON.stringify({
      runId: managed.runId, caseId, events, workFailed: failure !== undefined, cleanupErrors: cleanupErrors.length,
      requests: provider?.tasks.length ?? 0, tasks: provider?.tasks ?? [],
    }, null, 2)}\n`);
  }
  if (failure || cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "F1 scheduler experiment or cleanup failed.");
}

const due = "2026-11-01T19:00:00.000Z";
describe("F1 real scheduler ownership and lifecycle", () => {
  it("two real PIDs execute one bounded daily production batch", async () => withCase("parallel", async (h) => {
    const [first, second] = await Promise.all([h.start(), h.start()]);
    expect(first.pid).not.toBe(second.pid);
    const results = await Promise.all([first.request<DueResult>({ kind: "run-due", at: due }), second.request<DueResult>({ kind: "run-due", at: due })]);
    expect(results.map((item) => item.status).sort()).toEqual(["already-claimed", "completed"]);
    const rows = await h.rows(); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "COMPLETED", business_date: "2026-11-02", accepted_count: 1, requested_count: 1, signal_budget: 1, dispatch_budget: 30 });
    expect(rows[0]!.dispatch_count).toBeGreaterThan(0); expect(rows[0]!.dispatch_count).toBeLessThanOrEqual(30);
    expect(rows[0]!.dispatch_count).toBe(h.provider.tasks.length);
    expect(rows[0]!.result_signal_ids).toHaveLength(1);
    expect(h.provider.tasks.filter((task) => task === "signal-content")).toHaveLength(1);
    expect((await h.sql`select id from signals where source = 'ai_generated'`)).toHaveLength(1);
    expect((await h.sql`select id from ai_reviews where status = 'FALLBACK'`)).toHaveLength(0);
  }), 90_000);

  it("uses the configured timezone boundary and permits only a new business day", async () => withCase("calendar", async (h) => {
    const child = await h.start();
    expect(await child.request<DueResult>({ kind: "run-due", at: "2026-11-01T18:59:59.000Z" })).toMatchObject({ status: "not-due" });
    expect(await h.rows()).toHaveLength(0);
    expect(await child.request<DueResult>({ kind: "run-due", at: due })).toMatchObject({ status: "completed", businessDate: "2026-11-02" });
    expect(await child.request<DueResult>({ kind: "run-due", at: "2026-11-02T10:00:00.000Z" })).toMatchObject({ status: "already-claimed" });
    expect(await child.request<DueResult>({ kind: "run-due", at: "2026-11-02T19:00:00.000Z" })).toMatchObject({ status: "completed", businessDate: "2026-11-03" });
    expect((await h.rows()).map((row) => row.business_date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(h.provider.tasks.filter((task) => task === "signal-content")).toHaveLength(2);
  }), 90_000);

  it("never replays a claimed day after pure process death during real HTTP dispatch", async () => withCase("crash", async (h) => {
    const child = await h.start(); const hold = h.provider.holdNextRequest();
    const active = child.request<DueResult>({ kind: "run-due", at: due }); void active.catch(() => {});
    await bounded(hold.received, 5_000, "F1 did not dispatch its held real HTTP request.");
    const [before] = await h.rows(); expect(before).toMatchObject({ status: "RUNNING", dispatch_count: 1 });
    expect(before!.first_dispatch_at).not.toBeNull();
    await child.kill(); await expect(active).rejects.toThrow(); hold.release();
    const next = await h.start(); expect(next.pid).not.toBe(child.pid);
    expect(await next.request<DueResult>({ kind: "run-due", at: due })).toMatchObject({ status: "already-claimed" });
    expect(h.provider.tasks.filter((task) => task === "signal-content")).toHaveLength(1);
    expect((await h.rows())[0]).toMatchObject({ status: "RUNNING", dispatch_count: 1 });
    expect(await h.sql`select id from signals where source = 'ai_generated'`).toHaveLength(0);
  }), 90_000);

  it("app.close aborts the actual held request and naturally drains its scheduler PID", async () => withCase("close", async (h) => {
    const child = await h.start(); const hold = h.provider.holdNextRequest();
    const active = child.request<DueResult>({ kind: "run-due", at: due });
    void active.catch(() => {});
    await bounded(hold.received, 5_000, "F1 shutdown case did not dispatch real HTTP.");
    const diagnostics = await child.stop();
    expect(await active).toMatchObject({ status: "cancelled" });
    expect(diagnostics!.abortedHttp).toBeGreaterThan(0);
    expect((await h.rows())[0]).toMatchObject({ status: "CANCELLED", dispatch_count: 1, accepted_count: 0 });
    hold.release();
    expect(h.provider.tasks.filter((task) => task === "signal-content")).toHaveLength(1);
    expect(await h.sql`select id from signals where source = 'ai_generated'`).toHaveLength(0);
  }), 90_000);

  it("records an actual late SQL failure and never re-dispatches that day's batch", async () => withCase("failure", async (h) => {
    await h.sql.unsafe("create function f1_reject_generated() returns trigger language plpgsql as $$ begin if NEW.source = 'ai_generated' then raise exception 'F1_SYNTHETIC_INSERT_FAILURE'; end if; return NEW; end $$");
    await h.sql.unsafe("create trigger f1_reject_generated before insert on signals for each row execute function f1_reject_generated()");
    const child = await h.start();
    expect(await child.request<DueResult>({ kind: "run-due", at: due })).toMatchObject({ status: "failed" });
    const calls = h.provider.tasks.length;
    expect((await h.rows())[0]).toMatchObject({ status: "FAILED", accepted_count: 0 });
    expect(calls).toBeGreaterThan(1);
    expect(await child.request<DueResult>({ kind: "run-due", at: due })).toMatchObject({ status: "already-claimed" });
    expect(h.provider.tasks).toHaveLength(calls);
    expect(await h.sql`select id from signals where source = 'ai_generated'`).toHaveLength(0);
  }), 90_000);

  it("spends one durable dispatch allowance and blocks the next real Provider stage without replay", async () => withCase("budget", async (h) => {
    const child = await h.start();
    expect(await child.request<DueResult>({ kind: "run-due", at: due })).toMatchObject({ status: "failed" });
    expect(h.provider.tasks).toEqual(["signal-content"]);
    expect(await h.rows()).toEqual([expect.objectContaining({ status: "FAILED", failure_code: "BUDGET_EXHAUSTED",
      dispatch_budget: 1, dispatch_count: 1, accepted_count: 0 })]);
    expect(await child.request<DueResult>({ kind: "run-due", at: due })).toMatchObject({ status: "already-claimed" });
    expect(h.provider.tasks).toEqual(["signal-content"]);
    expect(await h.sql`select id from signals where source = 'ai_generated'`).toHaveLength(0);
  }), 90_000);

  it("the real repository rejects wrong owners and expired completion but records deadline failure", async () => withCase("fence", async (h) => {
    const child = await h.start();
    expect(await child.request({ kind: "repository-fence" })).toEqual({ wrongOwner: false, expiredCompleted: false,
      afterExpiredStatus: "RUNNING", failureAccepted: true });
    expect(await h.rows()).toEqual([expect.objectContaining({ status: "FAILED", failure_code: "DEADLINE", dispatch_count: 0 })]);
    expect(h.provider.tasks).toEqual([]);
  }), 90_000);
});
