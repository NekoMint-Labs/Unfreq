import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertManagedIntegrationEnvironment, installFetchBoundary } from "./harness.js";
import { createProviderStub, type IntegrationProvider, type ProviderRequestHold } from "./provider-stub.js";
import { fixtureSeed } from "./fixtures.js";
import type { GenerationBootPhase, GenerationCommand, GenerationDiagnostics, GenerationHttpResponse, GenerationMessage, GenerationWorkerState } from "./generation-process-fixture.js";

type Sql = ReturnType<typeof postgres>;
type CaseId = "restart" | "parallel" | "hidden" | "deleted" | "stale" | "failure";
type Journal = Array<Record<string, string | number | boolean | null>>;
type PendingReply = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
export type GenerationSession = { id: string; cookie: string };
export type GenerationRow = {
  id: string; status: string; generation_status: string; generation_error: string | null;
  expanded_text: string; updated_at: Date; positioned: boolean;
  generation_attempt_count: number | null; generation_attempt_id: string | null;
  generation_lease_owner: string | null; generation_lease_until: Date | null;
  generation_dispatch_started_at: Date | null; generation_attempt_deadline_at: Date | null;
  lease_expired: boolean;
};

const sleep = (milliseconds: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const emptyEnvironment = "# Owned generation integration environment; no project dotenv.\n";
// run 41f0ea0dec43 hit the original 10s startup watchdog; successful cases
// reached their first accepted request at around 10s including route work.
// Allow 20s for loader/import/guard setup, while retaining each
// business observation budget. This is fixture headroom, not a recovery SLA.
const coldReadyBudgetMs = 20_000;
const bootPhases: ReadonlySet<GenerationBootPhase> = new Set([
  "validation-start", "validation-complete", "db-guard-start", "db-guard-complete",
  "app-import-start", "app-import-complete", "app-build-start", "app-build-complete",
  "app-ready-start", "app-ready-complete",
]);

function safeSystemEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
    "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE",
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())).map(([key, value]) => [key.toUpperCase(), value]));
}

export class GenerationProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly closed: Promise<void>;
  readonly ready: Promise<void>;
  readonly logs: string[] = [];
  readonly errors: string[] = [];
  private pending = new Map<number, PendingReply>();
  private sequence = 0;
  private didClose = false;
  private lastBootPhase: GenerationBootPhase | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(environment: NodeJS.ProcessEnv, private journal: Journal, label: string) {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("./generation-process-fixture.ts", import.meta.url))], {
      cwd: root, env: environment, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child = child;
    this.pid = child.pid ?? -1;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let closeResolve!: () => void;
    this.ready = new Promise<void>((resolveReady, reject) => { readyResolve = resolveReady; readyReject = reject; });
    this.closed = new Promise<void>((resolveClosed) => { closeResolve = resolveClosed; });
    // A boot error may arrive before the caller reaches its await.
    void this.ready.catch(() => {});
    this.journal.push({ event: "spawn", label, pid: this.pid, readyBudgetMs: coldReadyBudgetMs, at: Date.now() });
    let capturedBytes = 0;
    const capture = (chunk: Buffer) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= 65_536) this.logs.push(chunk.toString("utf8"));
      else {
        this.errors.push("CHILD_LOG_LIMIT_EXCEEDED");
        void this.hardStop("log-limit").catch(() => {});
      }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.once("error", () => { this.errors.push("CHILD_SPAWN_ERROR"); readyReject(new Error("Generation child could not start.")); });
    child.once("close", (code, signal) => {
      this.didClose = true;
      this.journal.push({ event: "child-close", pid: this.pid, code, signal, at: Date.now() });
      readyReject(new Error("Generation child closed before ready."));
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Owned generation child closed before its command settled."));
      }
      this.pending.clear();
      closeResolve();
    });
    child.on("message", (input: unknown) => {
      if (!input || typeof input !== "object" || !("kind" in input)) return;
      const message = input as GenerationMessage;
      if (message.kind === "boot") {
        if (message.pid !== this.pid || !bootPhases.has(message.phase) || !Number.isSafeInteger(message.at) || message.at < 0) {
          this.errors.push("INVALID_CHILD_BOOT_CHECKPOINT");
          void this.hardStop("invalid-boot-checkpoint").catch(() => {});
        } else {
          this.lastBootPhase = message.phase;
          this.journal.push({ event: "child-boot", phase: message.phase, pid: message.pid, at: message.at, receivedAt: Date.now() });
        }
      } else if (message.kind === "ready") {
        if (message.pid !== this.pid) {
          this.errors.push("CHILD_PID_MISMATCH");
          void this.hardStop("pid-mismatch").catch(() => {});
        } else {
          this.journal.push({ event: "child-ready", pid: this.pid, at: Date.now() });
          readyResolve();
        }
      } else if (message.kind === "fatal") {
        this.errors.push(message.error);
        readyReject(new Error(`Generation fixture failed: ${message.error}`));
        void this.hardStop("fixture-fatal").catch(() => {});
      } else if (message.kind === "reply") {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        if (message.ok) entry.resolve(message.value);
        else entry.reject(new Error(`Generation fixture command failed: ${message.error}`));
      }
    });
  }

  get isClosed() { return this.didClose; }

  async waitReady() {
    let timer: NodeJS.Timeout | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.errors.push("CHILD_READY_TIMEOUT");
        this.journal.push({ event: "child-ready-timeout", pid: this.pid, budgetMs: coldReadyBudgetMs, lastBootPhase: this.lastBootPhase ?? null, at: Date.now() });
        void this.hardStop("ready-timeout").then(() => reject(new Error("Generation child cold start timed out after it was terminated.")), reject);
      }, coldReadyBudgetMs);
    });
    try { await Promise.race([this.ready, watchdog]); }
    catch (error) { await this.hardStop("failed-ready"); throw error; }
    finally { if (timer) clearTimeout(timer); }
  }

  async request<T = unknown>(command: GenerationCommand, milliseconds = 5_000): Promise<T> {
    if (this.didClose || !this.child.connected) throw new Error("Generation child is no longer connected.");
    const id = ++this.sequence;
    return await new Promise<T>((resolveReply, reject) => {
      const timer = setTimeout(() => {
        this.errors.push("CHILD_COMMAND_TIMEOUT");
        // A timeout never returns while its real command is still executing.
        void this.hardStop("command-timeout").then(() => reject(new Error("Generation command timed out; its owned process was terminated.")), reject);
      }, milliseconds);
      this.pending.set(id, { resolve: (value) => resolveReply(value as T), reject, timer });
      this.child.send({ id, command }, (error) => {
        if (error) {
          void this.hardStop("ipc-send-error").then(() => reject(new Error("Generation IPC send failed after terminating its process.")), reject);
        }
      });
    });
  }

  async hardStop(reason: string) {
    if (this.didClose) return;
    this.stopPromise ??= (async () => {
      this.journal.push({ event: "owned-kill", pid: this.pid, reason, at: Date.now() });
      this.child.kill("SIGKILL");
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.closed,
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Owned generation PID ${this.pid} did not close after SIGKILL.`)), 3_000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    })();
    await this.stopPromise;
  }

  async shutdown(): Promise<GenerationDiagnostics> {
    const diagnostics = await this.request<GenerationDiagnostics>({ kind: "shutdown" });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.closed,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Owned generation child retained resources after app.close().")), 3_000); }),
      ]);
    } catch (error) {
      await this.hardStop("graceful-close-timeout");
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    return diagnostics;
  }
}

export type GenerationHarness = {
  provider: IntegrationProvider;
  sql: Sql;
  journal: Journal;
  start: (label: string) => Promise<GenerationProcess>;
  register: (child: GenerationProcess, administrator?: boolean) => Promise<GenerationSession>;
  createPending: (child: GenerationProcess, session: GenerationSession) => Promise<string>;
  createManaged: (child: GenerationProcess, session: GenerationSession) => Promise<string>;
  inject: (child: GenerationProcess, command: Omit<Extract<GenerationCommand, { kind: "inject" }>, "kind">) => Promise<GenerationHttpResponse>;
  row: (id: string) => Promise<GenerationRow>;
  waitRow: (id: string, predicate: (row: GenerationRow) => boolean, label: string, milliseconds?: number) => Promise<GenerationRow>;
  waitHold: (hold: ProviderRequestHold, child: GenerationProcess) => Promise<void>;
  waitIdle: () => Promise<void>;
  record: (event: string, values?: Record<string, string | number | boolean | null>) => void;
  close: (workFailed?: boolean) => Promise<void>;
};

export async function createGenerationHarness(caseId: CaseId): Promise<GenerationHarness> {
  const managed = assertManagedIntegrationEnvironment();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 24);
  const digest = hash(managed.runId).slice(0, 10);
  const databaseName = `unfreq_integration_b1_${digest}_${caseId}_${nonce.slice(0, 8)}`;
  if (!/^unfreq_integration_b1_[a-f0-9]{10}_[a-z]{3,12}_[a-f0-9]{8}$/u.test(databaseName) || databaseName.length > 63) throw new Error("Invalid generation database name.");
  const directory = await mkdtemp(join(tmpdir(), `unfreq-generation-${nonce}-`));
  const databaseUrl = new URL(managed.databaseUrl);
  databaseUrl.protocol = "postgres:";
  databaseUrl.pathname = `/${databaseName}`;
  const children: GenerationProcess[] = [];
  const ownedIds = new Set<string>();
  const secrets = new Set([fixtureSeed, "generation-stub-only", "unfreq_integration_only", `generation-session-${nonce}`, `generation-provider-${nonce}`]);
  const journal: Journal = [{ event: "case-created", caseId, databaseName, runId: managed.runId, at: Date.now() }];
  let provider: IntegrationProvider | undefined;
  let restoreFetch: (() => void) | undefined;
  let admin: Sql | undefined;
  let sql: Sql | undefined;
  let databaseCreated = false;
  let markerWritten = false;
  let migrationsFinished = false;
  let closePromise: Promise<void> | undefined;
  const record = (event: string, values: Record<string, string | number | boolean | null> = {}) => journal.push({ event, ...values, at: Date.now() });

  const close = (workFailed = false) => closePromise ??= (async () => {
    const cleanupErrors: unknown[] = [];
    const experimentErrors: unknown[] = [];
    const attempt = async (work: () => Promise<unknown>, bucket: unknown[] = cleanupErrors) => {
      try { await work(); } catch (error) { bucket.push(error); }
    };
    // A deliberate crash stays a crash. Remaining children must instead prove
    // app.close() drained the real worker and all process resources; only a
    // failed shutdown falls back to killing the already-owned PID.
    for (const child of children) {
      if (!child.isClosed) {
        await attempt(async () => {
          const diagnostics = await child.request<GenerationDiagnostics>({ kind: "diagnostics" }, 1_000);
          record("child-diagnostics", { pid: child.pid, ...diagnostics });
          if (diagnostics.blockedHttp !== 0 || diagnostics.unhandled !== 0) throw new Error("Generation child violated its outbound/error boundary.");
        }, experimentErrors);
        await attempt(async () => {
          const diagnostics = await child.shutdown();
          if (diagnostics.blockedHttp !== 0 || diagnostics.unhandled !== 0) throw new Error("Generation child failed its shutdown diagnostics.");
          record("child-drained-and-closed", { pid: child.pid });
        }, experimentErrors);
      }
      await attempt(() => child.hardStop("test-teardown"));
      if (child.errors.length !== 0) experimentErrors.push(new Error(`Generation child infrastructure errors: ${child.errors.join(",")}`));
      const logs = child.logs.join("");
      record("child-log-summary", { pid: child.pid, bytes: Buffer.byteLength(logs), sha256: hash(logs) });
      if ([...secrets].some((secret) => secret.length > 0 && logs.includes(secret))) experimentErrors.push(new Error("Generation child log contained a synthetic sensitive marker."));
    }
    if (provider) {
      provider.releaseAll();
      await attempt(() => provider!.close());
      if (provider.blockedRequests.length || provider.tasks.includes("unsupported")) experimentErrors.push(new Error("Generation provider boundary or synthetic task contract failed."));
      record("provider-closed", { requests: provider.tasks.length, inFlight: provider.inFlight });
      if (provider.inFlight !== 0) cleanupErrors.push(new Error("Generation provider work remained after close."));
    }
    let dropAllowed = false;
    if (databaseCreated && admin) {
      await attempt(async () => {
        const [owner] = await admin!<{ owner: string }[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${databaseName}`;
        if (owner?.owner !== "unfreq_test") throw new Error("Refusing to drop a generation database with unexpected ownership.");
        if (markerWritten && sql) {
          const markers = await sql<{ run_id: string; case_id: string; nonce: string }[]>`select run_id, case_id, nonce from generation_test_ownership`;
          if (markers.length !== 1 || markers[0].run_id !== managed.runId || markers[0].case_id !== caseId || markers[0].nonce !== nonce) throw new Error("Refusing to drop a generation database with a changed run marker.");
          dropAllowed = true;
          const observer = sql;
          await attempt(async () => {
            if (ownedIds.size) {
              const rows = await observer<GenerationRow[]>`
                select id, status, generation_status, generation_error, expanded_text, updated_at, galaxy_position is not null as positioned,
                  generation_attempt_count, generation_attempt_id, generation_lease_owner, generation_lease_until,
                  generation_dispatch_started_at, generation_attempt_deadline_at,
                  coalesce(generation_lease_until <= clock_timestamp(), false) as lease_expired
                from signals where id in ${observer([...ownedIds])}
              `;
              for (const row of rows) record("final-owned-row", { id: row.id, status: row.status, generationStatus: row.generation_status,
                attemptCount: row.generation_attempt_count, attemptId: row.generation_attempt_id,
                hasLeaseOwner: row.generation_lease_owner !== null, dispatched: row.generation_dispatch_started_at !== null,
                contentSha256: hash(row.expanded_text) });
            }
            if (migrationsFinished) {
              const [reviews] = await observer<{ count: number }[]>`select count(*)::integer as count from ai_reviews where status = 'FALLBACK'`;
              if (reviews?.count !== 0) throw new Error("Generation fixture unexpectedly used a provider fallback.");
            }
          }, experimentErrors);
        } else {
          // Only a positively acknowledged CREATE DATABASE by this invocation
          // may be cleaned before marker setup. Never adopt a preexisting DB.
          if (markerWritten) throw new Error("Generation ownership marker cannot be verified.");
          record("partial-owned-database", { markerWritten: false });
        }
        dropAllowed = true;
      });
    }
    if (sql) await attempt(() => sql!.end({ timeout: 0 }));
    if (dropAllowed && admin) {
      await attempt(async () => {
        const deadline = Date.now() + 2_000;
        let remaining = await admin!<{ count: number }[]>`select count(*)::integer as count from pg_stat_activity where datname = ${databaseName}`;
        while (remaining[0]?.count !== 0 && Date.now() < deadline) {
          await sleep(20);
          remaining = await admin!<{ count: number }[]>`select count(*)::integer as count from pg_stat_activity where datname = ${databaseName}`;
        }
        if (remaining[0]?.count !== 0) throw new Error("Owned generation database still has clients; refusing a forced/global cleanup.");
        await admin!`drop database ${admin!(databaseName)}`;
        const rows = await admin!`select datname from pg_database where datname = ${databaseName}`;
        if (rows.length !== 0) throw new Error("Owned generation database remained after drop.");
        record("database-dropped");
      });
    }
    if (admin) await attempt(() => admin!.end({ timeout: 0 }));
    restoreFetch?.();
    await attempt(async () => {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(`unfreq-generation-${nonce}-`)) throw new Error("Refusing to remove an unowned generation media directory.");
      await rm(target, { recursive: true, force: true });
      record("media-directory-removed");
    });
    // A killed cold boot is an experiment infrastructure failure even when
    // every owned process/database/file was removed. Preserve the primary
    // work error outside close and report resource cleanup independently.
    record("cleanup-finished", { cleanupErrors: cleanupErrors.length, experimentErrors: experimentErrors.length, workFailed });
    await attempt(async () => {
      const evidenceDirectory = join(root, "test-results", "b1");
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(join(evidenceDirectory, `baseline-${managed.runId}-${caseId}-${nonce.slice(0, 8)}.json`), `${JSON.stringify({
        caseId, runId: managed.runId, journal, workFailed,
        experimentErrors: experimentErrors.length, experimentFailed: workFailed || experimentErrors.length > 0,
        cleanupErrors: cleanupErrors.length,
      }, null, 2)}\n`);
    }, experimentErrors);
    if (cleanupErrors.length || experimentErrors.length) throw new AggregateError([...experimentErrors, ...cleanupErrors], `Generation experiment or resource cleanup verification failed (experiment=${experimentErrors.length}, cleanup=${cleanupErrors.length}).`);
  })();

  try {
    await writeFile(join(directory, "empty.env"), emptyEnvironment);
    provider = await createProviderStub();
    restoreFetch = installFetchBoundary(provider);
    // Five seconds is the healthy disposable-service setup budget. The real
    // application still receives its existing 500ms health configuration.
    admin = postgres(managed.databaseUrl, { max: 1, prepare: false, connect_timeout: 5, connection: { application_name: `unfreq-b1-admin-${nonce}`, statement_timeout: 2500 } });
    const [identity] = await admin<{ database: string; owner: string }[]>`select current_database() as database, current_user as owner`;
    if (identity?.database !== "unfreq_integration" || identity.owner !== "unfreq_test") throw new Error("Generation runner database identity mismatch.");
    if ((await admin`select datname from pg_database where datname = ${databaseName}`).length) throw new Error("Generation test refuses an existing database.");
    await admin`create database ${admin(databaseName)}`;
    databaseCreated = true;
    sql = postgres(databaseUrl.toString(), { max: 1, prepare: false, connect_timeout: 5, connection: { application_name: `unfreq-b1-observer-${nonce}`, statement_timeout: 2500 } });
    const tables = await sql`select table_name from information_schema.tables where table_schema in ('public', 'drizzle')`;
    if (tables.length) throw new Error("Generation test requires a fresh empty database.");
    // Write the ownership marker before migrations, so failed migrations can
    // still be cleaned under the same owner/run/case/nonce checks.
    await sql`create table generation_test_ownership (run_id text not null, case_id text not null, nonce text primary key)`;
    await sql`insert into generation_test_ownership values (${managed.runId}, ${caseId}, ${nonce})`;
    markerWritten = true;
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    migrationsFinished = true;
    if ((await sql`select id from provider_configs`).length) throw new Error("Generation provider table must be empty.");
    const readySql = sql;
    const readyProvider = provider;
    const environment: NodeJS.ProcessEnv = {
      ...safeSystemEnvironment(), NODE_ENV: "test", UNFREQ_INTEGRATION_MANAGED: "1", UNFREQ_INTEGRATION_RUN_ID: managed.runId,
      UNFREQ_GENERATION_FIXTURE: "1", UNFREQ_GENERATION_PARENT_PID: String(process.pid),
      UNFREQ_GENERATION_CASE: caseId, UNFREQ_GENERATION_NONCE: nonce, UNFREQ_GENERATION_DIRECTORY: directory,
      UNFREQ_GENERATION_MODE: caseId === "stale" || caseId === "failure" ? "repository" : "worker",
      UNFREQ_GENERATION_PROVIDER_ORIGIN: readyProvider.origin,
      DATABASE_URL: databaseUrl.toString(), REDIS_URL: managed.redisUrl,
      DOTENV_CONFIG_PATH: join(directory, "empty.env"), DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_OVERRIDE: "false",
      AI_API_KEY: "generation-stub-only", AI_BASE_URL: `${readyProvider.origin}/v1`, AI_PROVIDER: "integration-loopback", AI_MODEL: "synthetic-signal-v1",
      AI_FAST_API_KEY: "", AI_FAST_BASE_URL: "", AI_FAST_MODEL: "", AI_FAST_PROVIDER: "",
      EMBEDDING_API_KEY: "", EMBEDDING_BASE_URL: "", EMBEDDING_DIMENSIONS: "1024", EMBEDDING_MODEL: "disabled", EMBEDDING_PROVIDER: "disabled", EMBEDDING_VERSION: "integration-v1",
      RERANKER_API_KEY: "", RERANKER_BASE_URL: "", RERANKER_MODEL: "disabled", RERANKER_PROVIDER: "disabled",
      TTS_API_KEY: "", TTS_BASE_URL: "", TTS_MODEL: "disabled", TTS_PROVIDER: "disabled", TTS_VOICE_LEFT: "integration", TTS_VOICE_RIGHT: "integration",
      TTS_STORAGE_DIR: join(directory, "audio"), IMAGE_STORAGE_DIR: join(directory, "images"), IMAGE_MAX_BYTES: "2097152",
      SESSION_SECRET: `generation-session-${nonce}`, PROVIDER_CONFIG_SECRET: `generation-provider-${nonce}`,
      AUTH_LOGIN_CODE_RESPONSE: "disabled", AUTH_LOGIN_DELIVERY_MODE: "local-log", AUTH_LOGIN_CHALLENGE_TTL_SECONDS: "600", AUTH_LOGIN_MAX_VERIFY_ATTEMPTS: "5", AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS: "1",
      WEB_ORIGIN: "http://127.0.0.1:3200", API_HOST: "127.0.0.1", API_PORT: "4000", HEALTH_DEPENDENCY_TIMEOUT_MS: "500", DB_POOL_MAX: "4", LOG_LEVEL: "error",
      SIGNAL_GENERATION_WORKER_ENABLED: "true", SIGNAL_GENERATION_CONCURRENCY: "2",
      SIGNAL_GENERATION_SCAN_INTERVAL_MS: "50", SIGNAL_GENERATION_LEASE_MS: "2000",
      SIGNAL_GENERATION_HEARTBEAT_MS: "200", SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS: "10000",
      SIGNAL_GENERATION_MAX_ATTEMPTS: "3", SIGNAL_GENERATION_RETRY_BASE_MS: "50",
      SIGNAL_GENERATION_RETRY_MAX_MS: "500", SIGNAL_GENERATION_SHUTDOWN_GRACE_MS: "200",
      SIGNAL_GENERATION_DB_STATEMENT_TIMEOUT_MS: "5000", SIGNAL_GENERATION_DB_LOCK_TIMEOUT_MS: "1000",
    };
    const inject = async (child: GenerationProcess, command: Omit<Extract<GenerationCommand, { kind: "inject" }>, "kind">) => child.request<GenerationHttpResponse>({ kind: "inject", ...command });
    const assertOwned = (id: string) => { if (!ownedIds.has(id)) throw new Error("Generation observation target does not belong to this case."); };
    const row = async (id: string) => {
      assertOwned(id);
      const [value] = await readySql<GenerationRow[]>`
        select id, status, generation_status, generation_error, expanded_text, updated_at, galaxy_position is not null as positioned,
          generation_attempt_count, generation_attempt_id, generation_lease_owner, generation_lease_until,
          generation_dispatch_started_at, generation_attempt_deadline_at,
          coalesce(generation_lease_until <= clock_timestamp(), false) as lease_expired
        from signals where id = ${id}
      `;
      if (!value) throw new Error("Owned generation row disappeared.");
      return value;
    };
    return {
      sql: readySql, provider: readyProvider, journal, record, close, inject, row,
      async start(label) {
        const child = new GenerationProcess(environment, journal, label);
        children.push(child);
        await child.waitReady();
        return child;
      },
      async register(child, administrator = false) {
        const password = `generation-password-${randomUUID()}`;
        secrets.add(password);
        const response = await inject(child, { method: "POST", url: "/api/auth/register", payload: { password } });
        if (response.statusCode !== 201 || !response.cookie) throw new Error("Synthetic generation registration failed.");
        const body = response.body as { data?: { frequency?: { id?: string }; sessionToken?: string } };
        const id = body.data?.frequency?.id;
        if (!id || !/^[a-f0-9-]{36}$/u.test(id)) throw new Error("Synthetic registration did not return an identity.");
        secrets.add(response.cookie);
        if (body.data?.sessionToken) secrets.add(body.data.sessionToken);
        if (administrator) {
          await readySql`update users set role = 'ADMIN' where id = ${id}`;
          await readySql`update frequencies set role = 'ADMIN' where id = ${id}`;
        }
        return { id, cookie: response.cookie };
      },
      async createPending(child, session) {
        const response = await inject(child, { method: "POST", url: "/api/signals", cookie: session.cookie, payload: { seedText: fixtureSeed } });
        const body = response.body as { data?: { signal?: { id?: string; status?: string; generationStatus?: string; visibility?: string } } };
        const signal = body.data?.signal;
        if (response.statusCode !== 201 || !signal?.id || !/^[a-f0-9-]{36}$/u.test(signal.id) || signal.status !== "DRAFT" || signal.generationStatus !== "RECEIVED" || signal.visibility !== "GENERATION_OWNER") throw new Error("Synthetic generation was not accepted as a durable pending signal.");
        ownedIds.add(signal.id);
        record("accepted-pending", { id: signal.id, pid: child.pid });
        return signal.id;
      },
      async createManaged(child, session) {
        if (caseId !== "stale" && caseId !== "failure") throw new Error("Repository-created fixtures are restricted to the two fence cases.");
        const response = await child.request<{ id: string; generationStatus: string; source: string }>({
          kind: "create-managed", authorId: session.id, cookie: session.cookie, seedText: fixtureSeed,
        });
        if (!/^[a-f0-9-]{36}$/u.test(response.id) || response.generationStatus !== "RECEIVED" || response.source !== "repository") throw new Error("Managed repository fixture did not persist its pending row.");
        ownedIds.add(response.id);
        const [confirmed] = await readySql`
          select id from signals where id = ${response.id} and author_id = ${session.id}
            and frequency_id = ${session.id} and seed_text = ${fixtureSeed} and raw_input = ${fixtureSeed}
            and status = 'DRAFT' and generation_status = 'RECEIVED'
            and generation_attempt_count = 0 and generation_attempt_id is null
            and generation_lease_owner is null and generation_dispatch_started_at is null
        `;
        if (confirmed === undefined) throw new Error("Repository-created fixture ownership or initial metadata did not match.");
        record("repository-managed-pending", { id: response.id, pid: child.pid });
        return response.id;
      },
      async waitRow(id, predicate, label, milliseconds = 3_000) {
        const deadline = Date.now() + milliseconds;
        let current = await row(id);
        while (!predicate(current) && Date.now() < deadline) { await sleep(25); current = await row(id); }
        record(label, { id, status: current.status, generationStatus: current.generation_status, contentSha256: hash(current.expanded_text) });
        if (!predicate(current)) throw new Error(`Generation invariant did not settle: ${label}; status=${current.status}, generation=${current.generation_status}.`);
        return current;
      },
      async waitHold(hold, child) {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            hold.received,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                void child.hardStop("provider-checkpoint-timeout").then(() => { hold.release(); reject(new Error("Provider checkpoint did not arrive; its owned process was terminated.")); }, reject);
              }, 3_000);
            }),
          ]);
        } finally { if (timer) clearTimeout(timer); }
      },
      async waitIdle() {
        const deadline = Date.now() + 3_000;
        do {
          const states = await Promise.all(children.filter((child) => !child.isClosed).map((child) =>
            child.request<GenerationWorkerState>({ kind: "worker-state" }, 1_000)));
          if (readyProvider.inFlight === 0 && states.every((state) => state.activeCount === 0)) return;
          await sleep(20);
        } while (Date.now() < deadline);
        throw new Error("Synthetic provider or real generation worker did not settle within the bounded observation window.");
      },
    };
  } catch (error) {
    record("setup-failed");
    try { await close(true); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Generation harness setup and teardown verification failed."); }
    throw error;
  }
}

export async function withGenerationHarness(caseId: CaseId, work: (harness: GenerationHarness) => Promise<void>) {
  const harness = await createGenerationHarness(caseId);
  let failure: unknown;
  let failed = false;
  try { await work(harness); }
  catch (error) { failed = true; failure = error; harness.record("work-failed"); }
  try { await harness.close(failed); }
  catch (cleanupError) {
    if (failed) throw new AggregateError([failure, cleanupError], "Generation case and teardown verification both failed; inspect separate experiment/cleanup diagnostics.");
    throw cleanupError;
  }
  if (failed) throw failure;
}
