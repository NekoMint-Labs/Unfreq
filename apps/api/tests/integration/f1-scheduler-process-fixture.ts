import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";

const emptyEnvironment = "# Owned F1 scheduler integration environment; no project dotenv.\n";
const messageSchema = z.object({ id: z.number().int().positive(), command: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run-due"), at: z.iso.datetime() }).strict(),
  z.object({ kind: z.literal("diagnostics") }).strict(),
  z.object({ kind: z.literal("repository-fence") }).strict(),
  z.object({ kind: z.literal("shutdown") }).strict(),
]) }).strict();
export type SchedulerCommand = z.infer<typeof messageSchema>["command"];
export type SchedulerDiagnostics = { blockedHttp: number; pendingHttp: number; abortedHttp: number; unhandled: number };
export type SchedulerMessage =
  | { kind: "ready"; pid: number }
  | { kind: "fatal"; error: string }
  | { kind: "reply"; id: number; ok: boolean; value?: unknown };

async function send(message: SchedulerMessage) {
  if (!process.send || !process.connected) throw new Error("F1 scheduler fixture lost its owner.");
  await new Promise<void>((yes, no) => process.send!(message, (error) => error ? no(error) : yes()));
}

async function validate() {
  const env = process.env;
  const runId = env.UNFREQ_INTEGRATION_RUN_ID ?? "";
  const caseId = env.UNFREQ_F1_CASE ?? "";
  const nonce = env.UNFREQ_F1_NONCE ?? "";
  if (env.UNFREQ_INTEGRATION_MANAGED !== "1" || env.UNFREQ_F1_FIXTURE !== "1" ||
      !/^[a-f0-9]{12}$/u.test(runId) || !["parallel", "calendar", "crash", "close", "failure", "budget", "fence"].includes(caseId) ||
      !/^[a-f0-9]{24}$/u.test(nonce) || Number(env.UNFREQ_F1_PARENT_PID) !== process.ppid) throw new Error("Invalid F1 fixture ownership.");
  await verifyIntegrationRuntime({ runId, entry: "scheduler", runtimeDirectory: env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "",
    ownershipToken: env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "", executingEntry: fileURLToPath(import.meta.url) });
  const digest = createHash("sha256").update(runId).digest("hex").slice(0, 10);
  const databaseName = `unfreq_integration_f1_${digest}_${caseId}_${nonce.slice(0, 8)}`;
  const database = new URL(env.DATABASE_URL ?? "");
  const redis = new URL(env.REDIS_URL ?? "");
  const provider = new URL(env.UNFREQ_F1_PROVIDER_ORIGIN ?? "");
  const testPort = (port: string) => Number(port) >= 1024 && Number(port) <= 65535 && ![5432, 6379].includes(Number(port));
  if (!/^unfreq_integration_f1_[a-f0-9]{10}_[a-z]{5,8}_[a-f0-9]{8}$/u.test(databaseName) || databaseName.length > 63 ||
      database.protocol !== "postgres:" || database.hostname !== "127.0.0.1" || !testPort(database.port) ||
      database.pathname !== `/${databaseName}` || database.username !== "unfreq_test" || database.password !== "unfreq_integration_only" || database.search || database.hash ||
      redis.protocol !== "redis:" || redis.hostname !== "127.0.0.1" || !testPort(redis.port) || redis.port === database.port ||
      redis.username || redis.password || !["", "/", "/0"].includes(redis.pathname) || redis.search || redis.hash ||
      provider.protocol !== "http:" || provider.hostname !== "127.0.0.1" || !testPort(provider.port) || provider.pathname !== "/" || provider.username || provider.password || provider.search || provider.hash ||
      env.AI_BASE_URL !== `${provider.origin}/v1` || env.AI_API_KEY !== "f1-scheduler-stub-only" ||
      env.SESSION_SECRET !== `f1-scheduler-session-${nonce}` || env.PROVIDER_CONFIG_SECRET !== `f1-scheduler-provider-${nonce}` ||
      env.NODE_ENV !== "test" || env.NODE_OPTIONS !== undefined || env.DOTENV_KEY !== undefined || env.SIGNAL_GENERATION_WORKER_ENABLED !== "false") {
    throw new Error("Invalid F1 synthetic endpoints or configuration.");
  }
  for (const key of ["AI_FAST_API_KEY", "AI_FAST_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "RERANKER_API_KEY", "RERANKER_BASE_URL", "TTS_API_KEY", "TTS_BASE_URL"]) {
    if (env[key] !== "") throw new Error("Additional F1 providers are forbidden.");
  }
  const directory = resolve(env.UNFREQ_F1_DIRECTORY ?? "");
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(`unfreq-f1-${nonce}-`) ||
      env.DOTENV_CONFIG_PATH !== join(directory, "empty.env") || env.TTS_STORAGE_DIR !== join(directory, "audio") ||
      env.IMAGE_STORAGE_DIR !== join(directory, "images") || await readFile(join(directory, "empty.env"), "utf8") !== emptyEnvironment) {
    throw new Error("Invalid F1 owned directory.");
  }
  const guard = postgres(database.toString(), { infer: true, max: 1, prepare: false, connect_timeout: 5 });
  try {
    const [identity] = await guard<{ database: string; owner: string }[]>`select current_database() as database, current_user as owner`;
    const marker = await guard<{ run_id: string; case_id: string; nonce: string }[]>`select run_id, case_id, nonce from scheduler_test_ownership`;
    const [owner] = await guard<{ owner: string }[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()`;
    if (identity?.database !== databaseName || identity.owner !== "unfreq_test" || owner?.owner !== "unfreq_test" ||
        marker.length !== 1 || marker[0].run_id !== runId || marker[0].case_id !== caseId || marker[0].nonce !== nonce ||
        (await guard`select id from provider_configs`).length !== 0) throw new Error("F1 database ownership changed.");
  } finally { await guard.end({ timeout: 0 }); }
  return { origin: provider.origin, caseId, databaseUrl: database.toString() };
}

async function main() {
  const owned = await validate();
  const originalFetch = globalThis.fetch;
  let blockedHttp = 0; let pendingHttp = 0; let abortedHttp = 0; let unhandled = 0; let closing = false;
  globalThis.fetch = (async (input, init) => {
    let url: URL;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); }
    catch { blockedHttp++; throw new Error("F1 outbound HTTP blocked."); }
    if (url.origin !== owned.origin) { blockedHttp++; throw new Error("F1 outbound HTTP blocked."); }
    pendingHttp++;
    const aborted = () => { abortedHttp++; };
    init?.signal?.addEventListener("abort", aborted, { once: true });
    try { return await originalFetch(input, { ...init, redirect: "error" }); }
    finally { pendingHttp--; init?.signal?.removeEventListener("abort", aborted); }
  }) as typeof fetch;
  // Application/configuration modules are loaded only after the runtime, DB
  // ownership, endpoints and real HTTP boundary have all been verified.
  const { buildApp } = await import("../../src/app.js");
  const { createAiSignalScheduler } = await import("../../src/modules/signals/scheduler.js");
  const config = {
    enabled: true, timeZone: "Asia/Shanghai", scheduledTime: "03:00", count: 1, dailySignalBudget: 1,
    dailyDispatchBudget: owned.caseId === "budget" ? 1 : 30, pollIntervalMs: 60_000, batchTimeoutMs: 10_000, shutdownGraceMs: 2_000,
    dbStatementTimeoutMs: 2_000, dbLockTimeoutMs: 500,
  };
  let scheduler: ReturnType<typeof createAiSignalScheduler> | undefined;
  const app = await buildApp({ logger: false, aiSignalSchedulerFactory(options) {
    scheduler = createAiSignalScheduler({ ...options, now: () => new Date("2026-11-01T18:00:00.000Z"), config });
    return scheduler;
  } });
  await app.ready();
  if (!scheduler) throw new Error("The real application did not construct its scheduler.");
  const actualScheduler = scheduler;
  const activeRuns = new Set<Promise<void>>();
  const probeRepositoryFence = async () => {
    if (owned.caseId !== "fence") throw new Error("Repository fence probe is restricted to its owned case.");
    const { configureAiSignalSchedulerRepository } = await import("../../src/modules/signals/scheduler-repository.js");
    const repository = configureAiSignalSchedulerRepository(config);
    const sql = postgres(owned.databaseUrl, { infer: true, max: 1, prepare: false, connect_timeout: 5, connection: { statement_timeout: 2000 } });
    try {
      const claim = await repository.claim({ businessDate: "2026-11-09", ownerToken: randomUUID(), config });
      if (!claim) throw new Error("Fresh repository fence claim failed.");
      const progress = { accepted: 0, rejected: 0, attempts: 0, signalIds: [] };
      const wrongOwner = await repository.finish({ ...claim, ownerToken: randomUUID() }, { ...progress, status: "COMPLETED" });
      await sql`update ai_signal_scheduler_batches set deadline_at = clock_timestamp() - interval '1 second' where id = ${claim.id}`;
      const expiredCompleted = await repository.finish(claim, { ...progress, status: "COMPLETED" });
      const [afterExpired] = await sql`select status from ai_signal_scheduler_batches where id = ${claim.id}`;
      const failureAccepted = await repository.finish(claim, { ...progress, status: "FAILED", failureCode: "DEADLINE" });
      return { wrongOwner, expiredCompleted, afterExpiredStatus: afterExpired?.status, failureAccepted };
    } finally { await sql.end({ timeout: 0 }); await repository.close(); }
  };
  const diagnostics = (): SchedulerDiagnostics => ({ blockedHttp, pendingHttp, abortedHttp, unhandled });
  const fatal = () => { unhandled++; void send({ kind: "fatal", error: "F1_FIXTURE_FATAL" }).finally(() => process.exit(1)); };
  process.on("unhandledRejection", fatal); process.on("uncaughtException", fatal);
  process.once("disconnect", () => { if (!closing) process.exit(1); });
  process.on("message", (raw: unknown) => {
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) { fatal(); return; }
    const { id, command } = parsed.data;
    if (closing) { void send({ kind: "reply", id, ok: false }).catch(fatal); return; }
    if (command.kind === "run-due") {
      const run = actualScheduler.runDue(new Date(command.at)).then((value) => send({ kind: "reply", id, ok: true, value }));
      activeRuns.add(run); void run.finally(() => activeRuns.delete(run)).catch(fatal);
    } else if (command.kind === "diagnostics") {
      void send({ kind: "reply", id, ok: true, value: diagnostics() }).catch(fatal);
    } else if (command.kind === "repository-fence") {
      const run = probeRepositoryFence().then((value) => send({ kind: "reply", id, ok: true, value }));
      activeRuns.add(run); void run.finally(() => activeRuns.delete(run)).catch(fatal);
    } else {
      closing = true;
      void (async () => {
        await app.close();
        await Promise.all(activeRuns);
        await send({ kind: "reply", id, ok: true, value: diagnostics() });
        globalThis.fetch = originalFetch;
        process.disconnect?.();
      })().catch(fatal);
    }
  });
  await send({ kind: "ready", pid: process.pid });
}

void main().catch(() => { void send({ kind: "fatal", error: "F1_FIXTURE_BOOT_FAILED" }).finally(() => process.exit(1)); });
