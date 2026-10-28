import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { z } from "zod";
import type { GenerationClaim, GenerationOutput } from "../../src/modules/signals/generation-types.js";
import type { SignalGenerationWorker } from "../../src/modules/signals/generation-worker.js";
import type { GenerationControlState } from "./generation-test-controls.js";
import { fixtureExpansion, fixtureFingerprint, fixtureSeed } from "./fixtures.js";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";

const commandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inject"), method: z.enum(["GET", "POST", "PATCH"]),
    url: z.string().max(160), cookie: z.string().max(2048).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ kind: z.literal("create-managed"), authorId: z.string().uuid(), cookie: z.string().max(2048), seedText: z.literal(fixtureSeed) }).strict(),
  z.object({ kind: z.literal("stage"), id: z.string().uuid(), marker: z.enum(["older", "newer"]) }).strict(),
  z.object({ kind: z.literal("complete"), marker: z.enum(["older", "newer"]) }).strict(),
  z.object({ kind: z.literal("fail"), marker: z.enum(["older", "newer"]) }).strict(),
  z.object({ kind: z.literal("diagnostics") }).strict(),
  z.object({ kind: z.literal("worker-state") }).strict(),
  z.object({ kind: z.literal("control-state") }).strict(),
  z.object({ kind: z.literal("checkpoint-arm"), point: z.enum(["before-dispatch", "before-complete", "before-next-claim"]) }).strict(),
  z.object({ kind: z.literal("checkpoint-release"), gateId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("probe-completion"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("shutdown") }).strict(),
]);
const messageSchema = z.object({ id: z.number().int().positive(), command: commandSchema }).strict();

export type GenerationCommand = z.infer<typeof commandSchema>;
export type GenerationHttpResponse = { statusCode: number; body: unknown; cookie?: string };
export type GenerationDiagnostics = { blockedHttp: number; unhandled: number };
export type GenerationShutdownDiagnostics = GenerationDiagnostics & { pendingHttp: number; abortedHttp: number };
export type GenerationWorkerState = { mode: "worker" | "repository"; accepting: boolean; activeCount: number };
export type GenerationStageResult = {
  staged: "older" | "newer"; id: string; attemptId: string; ownerId: string;
  attemptCount: number; leaseUntil: string; deadlineAt: string; phase: "WRITING";
};
export type GenerationWriteResult = { accepted: boolean; outcome: "APPLIED" | "OBSOLETE" };
export type GenerationBootPhase =
  | "validation-start" | "validation-complete"
  | "db-guard-start" | "db-guard-complete"
  | "app-import-start" | "app-import-complete"
  | "app-build-start" | "app-build-complete"
  | "app-ready-start" | "app-ready-complete";
export type GenerationMessage =
  | { kind: "boot"; phase: GenerationBootPhase; pid: number; at: number }
  | { kind: "ready"; pid: number }
  | { kind: "reply"; id: number; ok: true; value: unknown }
  | { kind: "reply"; id: number; ok: false; error: string }
  | { kind: "fatal"; error: string };

const emptyEnvironment = "# Owned generation integration environment; no project dotenv.\n";
type CommandPhase = "START" | "HTTP" | "CREATE" | "OWNED_SIGNAL" | "RECOVER" | "CLAIM" | "READ_INPUT" | "ADVANCE" | "SERIALIZE" | "COMPLETE" | "FAIL" | "SHUTDOWN" | "CONTROL";
export const generationEmptyEnvironment = emptyEnvironment;

async function send(message: GenerationMessage) {
  if (!process.send || !process.connected) throw new Error("Generation fixture lost its owner.");
  await new Promise<void>((resolveSend, reject) => {
    process.send!(message, (error) => error ? reject(error) : resolveSend());
  });
}

const checkpoint = (phase: GenerationBootPhase) => send({ kind: "boot", phase, pid: process.pid, at: Date.now() });

async function validateEnvironment() {
  const env = process.env;
  const runId = env.UNFREQ_INTEGRATION_RUN_ID ?? "";
  const caseId = env.UNFREQ_GENERATION_CASE ?? "";
  const nonce = env.UNFREQ_GENERATION_NONCE ?? "";
  const cases = new Set(["restart", "parallel", "hidden", "deleted", "stale", "failure", "preclaim", "predispatch", "prewrite", "capacity", "aba", "close", "closeearly", "retry", "exhaust"]);
  if (env.UNFREQ_INTEGRATION_MANAGED !== "1" || env.UNFREQ_GENERATION_FIXTURE !== "1" ||
      !/^[a-zA-Z0-9_-]{8,96}$/u.test(runId) || !/^[a-z]{3,12}$/u.test(caseId) || !cases.has(caseId) ||
      !/^[a-f0-9]{24}$/u.test(nonce) || Number(env.UNFREQ_GENERATION_PARENT_PID) !== process.ppid) {
    throw new Error("Invalid generation fixture ownership.");
  }
  await verifyIntegrationRuntime({ runId,
    runtimeDirectory: env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "",
    ownershipToken: env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "",
    executingEntry: fileURLToPath(import.meta.url) });
  const digest = createHash("sha256").update(runId).digest("hex").slice(0, 10);
  const databaseName = `unfreq_integration_b1_${digest}_${caseId}_${nonce.slice(0, 8)}`;
  const database = new URL(env.DATABASE_URL ?? "");
  const redis = new URL(env.REDIS_URL ?? "");
  const provider = new URL(env.UNFREQ_GENERATION_PROVIDER_ORIGIN ?? "");
  const testPort = (port: string) => Number(port) >= 1024 && Number(port) <= 65535 && ![5432, 6379].includes(Number(port));
  if (!/^unfreq_integration_b1_[a-f0-9]{10}_[a-z]{3,12}_[a-f0-9]{8}$/u.test(databaseName) || databaseName.length > 63 ||
      database.protocol !== "postgres:" || database.hostname !== "127.0.0.1" || !testPort(database.port) ||
      database.pathname !== `/${databaseName}` || database.username !== "unfreq_test" ||
      database.password !== "unfreq_integration_only" || database.search !== "" || database.hash !== "" ||
      redis.protocol !== "redis:" || redis.hostname !== "127.0.0.1" || !testPort(redis.port) ||
      redis.username !== "" || redis.password !== "" || !["", "/", "/0"].includes(redis.pathname) ||
      redis.search !== "" || redis.hash !== "" || redis.port === database.port ||
      provider.protocol !== "http:" || provider.hostname !== "127.0.0.1" || !testPort(provider.port) ||
      provider.pathname !== "/" || provider.username !== "" || provider.password !== "" || provider.search !== "" || provider.hash !== "" ||
      env.AI_BASE_URL !== `${provider.origin}/v1` || env.AI_API_KEY !== "generation-stub-only" ||
      env.SESSION_SECRET !== `generation-session-${nonce}` || env.PROVIDER_CONFIG_SECRET !== `generation-provider-${nonce}` ||
      env.NODE_ENV !== "test" || env.NODE_OPTIONS !== undefined || env.DOTENV_KEY !== undefined) {
    throw new Error("Invalid generation fixture endpoints or synthetic configuration.");
  }
  for (const key of ["AI_FAST_API_KEY", "AI_FAST_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "RERANKER_API_KEY", "RERANKER_BASE_URL", "TTS_API_KEY", "TTS_BASE_URL"]) {
    if (env[key] !== "") throw new Error("Additional generation provider configuration is forbidden.");
  }
  const workerEnvironment = {
    SIGNAL_GENERATION_WORKER_ENABLED: "true", SIGNAL_GENERATION_CONCURRENCY: "2",
    SIGNAL_GENERATION_SCAN_INTERVAL_MS: "50", SIGNAL_GENERATION_LEASE_MS: "2000",
    SIGNAL_GENERATION_HEARTBEAT_MS: "200", SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS: "10000",
    SIGNAL_GENERATION_MAX_ATTEMPTS: "3", SIGNAL_GENERATION_RETRY_BASE_MS: ["retry", "exhaust"].includes(caseId) ? "200" : "50",
    SIGNAL_GENERATION_RETRY_MAX_MS: ["retry", "exhaust"].includes(caseId) ? "300" : "500", SIGNAL_GENERATION_SHUTDOWN_GRACE_MS: "200",
    SIGNAL_GENERATION_DB_STATEMENT_TIMEOUT_MS: "5000", SIGNAL_GENERATION_DB_LOCK_TIMEOUT_MS: "1000",
  };
  for (const [key, value] of Object.entries(workerEnvironment)) {
    if (env[key] !== value) throw new Error("Generation worker configuration must be entirely synthetic.");
  }
  const mode = caseId === "stale" || caseId === "failure" ? "repository" : "worker";
  if (env.UNFREQ_GENERATION_MODE !== mode) throw new Error("Generation fixture mode does not match its owned case.");
  const directory = resolve(env.UNFREQ_GENERATION_DIRECTORY ?? "");
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(`unfreq-generation-${nonce}-`) ||
      env.DOTENV_CONFIG_PATH !== join(directory, "empty.env") ||
      env.TTS_STORAGE_DIR !== join(directory, "audio") || env.IMAGE_STORAGE_DIR !== join(directory, "images") ||
      await readFile(join(directory, "empty.env"), "utf8") !== emptyEnvironment) {
    throw new Error("Invalid generation fixture temporary directory.");
  }
  return { runId, caseId, nonce, databaseName, databaseUrl: database.toString(), origin: provider.origin, mode } as const;
}

function allowedRequest(command: Extract<GenerationCommand, { kind: "inject" }>) {
  if (command.method === "GET") return command.url === "/health" || /^\/api\/signals\/[a-f0-9-]{36}$/u.test(command.url);
  if (command.method === "POST") return ["/api/auth/register", "/api/signals"].includes(command.url) || /^\/api\/signals\/[a-f0-9-]{36}\/publish$/u.test(command.url);
  return /^\/api\/admin\/signals\/[a-f0-9-]{36}\/status$/u.test(command.url);
}

async function main() {
  // The initial checkpoint follows the TS loader/static imports. Its gap from
  // the parent's spawn timestamp therefore also reveals pre-validation cost.
  // Boot IPC contains fixed phase names, PID and timestamps only.
  await checkpoint("validation-start");
  const owned = await validateEnvironment();
  await checkpoint("validation-complete");
  const originalFetch = globalThis.fetch;
  let blockedHttp = 0;
  let unhandled = 0;
  let pendingHttp = 0;
  let abortedHttp = 0;
  globalThis.fetch = (async (input, init) => {
    let url: URL;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); }
    catch { blockedHttp += 1; throw new Error("Generation outbound HTTP blocked."); }
    if (url.origin !== owned.origin) {
      blockedHttp += 1;
      throw new Error("Generation outbound HTTP blocked.");
    }
    pendingHttp += 1;
    const signal = init?.signal;
    const aborted = () => { abortedHttp += 1; };
    signal?.addEventListener("abort", aborted, { once: true });
    try { return await originalFetch(input, { ...init, redirect: "error" }); }
    finally { pendingHttp -= 1; signal?.removeEventListener("abort", aborted); }
  }) as typeof fetch;

  // No app/env/db module is imported until both endpoint validation and the
  // HTTP boundary are installed. This client only checks our owned database.
  await checkpoint("db-guard-start");
  // Healthy disposable-DB guard only: this is not the application's health
  // connection budget, which stays at HEALTH_DEPENDENCY_TIMEOUT_MS=500.
  const guard = postgres(owned.databaseUrl, { max: 1, prepare: false, connect_timeout: 5 });
  try {
    const [identity] = await guard<{ database: string; owner: string }[]>`
      select current_database() as database, current_user as owner
    `;
    const markers = await guard<{ run_id: string; case_id: string; nonce: string }[]>`select run_id, case_id, nonce from generation_test_ownership`;
    const [database] = await guard<{ owner: string }[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()`;
    if (identity?.database !== owned.databaseName || identity.owner !== "unfreq_test" || database?.owner !== "unfreq_test" ||
        markers.length !== 1 || markers[0].run_id !== owned.runId || markers[0].case_id !== owned.caseId || markers[0].nonce !== owned.nonce ||
        (await guard`select id from provider_configs`).length !== 0) {
      throw new Error("Generation database ownership or provider configuration changed.");
    }
  } finally { await guard.end({ timeout: 0 }); }
  await checkpoint("db-guard-complete");

  await checkpoint("app-import-start");
  const { buildApp } = await import("../../src/app.js");
  const repository = await import("../../src/modules/signals/repository.js");
  const { authenticateSessionToken } = await import("../../src/modules/auth/service.js");
  const { configureSignalGenerationRepository } = await import("../../src/modules/signals/generation-repository.js");
  const { createSignalGenerationWorker } = await import("../../src/modules/signals/generation-worker.js");
  const { createGenerationTestControls } = await import("./generation-test-controls.js");
  const { getFingerprintFrequencyProfile, buildMinimalSignalProgram } = await import("../../src/modules/signals/service-mappers.js");
  const actualRepository = configureSignalGenerationRepository({
    statementTimeoutMs: 5000, lockTimeoutMs: 1000, maxConnections: 2,
  });
  const generationRepository = owned.mode === "repository" ? actualRepository : undefined;
  const controls = createGenerationTestControls(actualRepository, owned.caseId);
  let worker: SignalGenerationWorker | undefined;
  await checkpoint("app-import-complete");
  await checkpoint("app-build-start");
  const app: FastifyInstance = await buildApp({
    logger: false,
    generationWorkerFactory(options) {
      // Only the two repository-fence cases have no consumer. Their pending
      // rows are explicitly inserted through the real repository below, never
      // presented as an accepted HTTP generation or a route recovery test.
      const real = generationRepository === undefined ? createSignalGenerationWorker({ ...options, repository: controls.repository }) : undefined;
      worker = real === undefined ? {
        accepting: false, activeCount: 0,
        start() { return; }, wake() { return; },
        async stop() { await actualRepository.closeSignalGenerationRepository({ timeoutSeconds: 0 }); },
      } : {
        get accepting() { return real.accepting; }, get activeCount() { return real.activeCount; },
        start() { real.start(); }, wake() { real.wake(); },
        stop() { controls.stopScanGate(); return real.stop(); },
      };
      return worker;
    },
  });
  await checkpoint("app-build-complete");
  await checkpoint("app-ready-start");
  await app.ready();
  await checkpoint("app-ready-complete");
  const staged = new Map<"older" | "newer", { fence: GenerationClaim; output: GenerationOutput }>();
  const registeredAuthors = new Set<string>();
  const leaseOwnerId = randomUUID();
  let closing = false;

  const fatal = () => {
    unhandled += 1;
    void send({ kind: "fatal", error: "UNHANDLED_GENERATION_FIXTURE_ERROR" }).finally(() => process.exit(1));
  };
  process.on("unhandledRejection", fatal);
  process.on("uncaughtException", fatal);
  process.once("disconnect", () => { if (!closing) process.exit(1); });

  async function ownedSignal(id: string) {
    const signal = await repository.findSignalResultById(id);
    if (!signal || signal.seedText !== fixtureSeed || !signal.authorId || signal.frequencyId !== signal.authorId) {
      throw new Error("Refusing a non-fixture generation target.");
    }
    return signal;
  }

  async function execute(command: GenerationCommand, phase: (value: CommandPhase) => void): Promise<unknown> {
    if (closing) throw new Error("Generation fixture is closing.");
    if (command.kind === "diagnostics") return { blockedHttp, unhandled } satisfies GenerationDiagnostics;
    if (command.kind === "worker-state") {
      if (worker === undefined) throw new Error("Generation worker was not constructed.");
      return { mode: owned.mode, accepting: worker.accepting, activeCount: worker.activeCount } satisfies GenerationWorkerState;
    }
    if (command.kind === "control-state") return controls.state satisfies GenerationControlState;
    if (command.kind === "checkpoint-arm") { phase("CONTROL"); return controls.arm(command.point); }
    if (command.kind === "checkpoint-release") { phase("CONTROL"); return controls.release(command.gateId); }
    if (command.kind === "probe-completion") {
      phase("CONTROL");
      if (owned.caseId !== "aba" || worker?.activeCount !== 0) throw new Error("ABA probe requires its real worker to have drained.");
      await ownedSignal(command.id);
      return controls.probeCompletion(command.id);
    }
    if (command.kind === "inject") {
      phase("HTTP");
      if (!allowedRequest(command)) throw new Error("Generation route is not allowed.");
      const response = await app.inject({
        method: command.method, url: command.url,
        headers: command.cookie === undefined ? {} : { cookie: command.cookie },
        ...(command.payload === undefined ? {} : { payload: command.payload }),
      });
      const cookies = response.headers["set-cookie"];
      const cookie = (Array.isArray(cookies) ? cookies : [String(cookies ?? "")])
        .find((value) => value.startsWith("unfreq_session="))?.split(";")[0];
      const body = response.json<unknown>();
      if (command.method === "POST" && command.url === "/api/auth/register" && response.statusCode === 201) {
        const registration = z.object({ data: z.object({ frequency: z.object({ id: z.string().uuid() }) }) }).parse(body);
        registeredAuthors.add(registration.data.frequency.id);
      }
      return { statusCode: response.statusCode, body, ...(cookie ? { cookie } : {}) } satisfies GenerationHttpResponse;
    }
    if (command.kind === "create-managed") {
      phase("CREATE");
      if (generationRepository === undefined || !registeredAuthors.has(command.authorId)) throw new Error("Managed fixture creation requires its registered synthetic author and inert consumer.");
      const token = /^unfreq_session=([^;]+)$/u.exec(command.cookie)?.[1];
      const author = token === undefined ? undefined : await authenticateSessionToken(token);
      if (author?.id !== command.authorId || author.status !== "ACTIVE" || author.isGuest) throw new Error("Managed fixture author session is not valid.");
      const expandedText = "信号正在生成。";
      const signal = await generationRepository.createManagedPendingSignal({
        authorId: author.id, frequencyId: author.id, seedText: command.seedText, rawInput: command.seedText,
        expandedText, fingerprint: fixtureFingerprint, frequencyProfile: getFingerprintFrequencyProfile(fixtureFingerprint),
        generationStatus: "RECEIVED", status: "DRAFT",
        program: buildMinimalSignalProgram({ expandedText, fingerprint: fixtureFingerprint, rawInput: command.seedText }),
      });
      return { id: signal.id, generationStatus: signal.generationStatus, source: "repository" };
    }
    if (command.kind === "stage") {
      phase("OWNED_SIGNAL");
      if (generationRepository === undefined) throw new Error("Repository staging is forbidden in consumer cases.");
      if (staged.has(command.marker)) throw new Error("Generation writer is already staged.");
      const signal = await ownedSignal(command.id);
      if (command.marker === "newer") {
        phase("RECOVER");
        const recovered = await generationRepository.recoverExpiredSignalGenerations({
          batchSize: 1, maxAttempts: 3, backoffForAttempt: () => 0,
        });
        if (recovered.requeuedIds.length !== 1 || recovered.requeuedIds[0] !== signal.id || recovered.failedIds.length !== 0) throw new Error("Newer writer did not recover the actual expired undispatched attempt.");
      }
      phase("CLAIM");
      const claims = await generationRepository.claimSignalGenerationBatch({
        ownerId: leaseOwnerId, globalCapacity: 2, localAvailable: 1,
        leaseMs: command.marker === "older" ? 300 : 10000, attemptTimeoutMs: 10000, maxAttempts: 3,
      });
      const fence = claims[0];
      if (claims.length !== 1 || fence?.signalId !== signal.id || fence.attemptCount !== (command.marker === "older" ? 1 : 2)) throw new Error("Repository did not grant the expected real generation lease.");
      phase("READ_INPUT");
      const input = await generationRepository.readOwnedSignalGenerationInput(fence);
      if (input.outcome !== "APPLIED" || input.value.body.seedText !== fixtureSeed || input.value.frequency.id !== signal.authorId) throw new Error("Claim did not reconstruct the owned fixture input.");
      for (const [from, to] of [["EXPANDING", "MATCHING"], ["MATCHING", "WRITING"]] as const) {
        phase("ADVANCE");
        const result = await generationRepository.advanceSignalGenerationPhase({ fence, from, to });
        if (result.outcome !== "APPLIED") throw new Error("Fresh real lease did not advance to WRITING.");
      }
      const expandedText = `${fixtureExpansion.expandedText}\n[synthetic-${command.marker}]`;
      staged.set(command.marker, {
        fence,
        output: {
          expandedText, fingerprint: fixtureFingerprint,
          frequencyProfile: getFingerprintFrequencyProfile(fixtureFingerprint),
          galaxyPosition: { x: 0, y: 0, z: 0 }, status: "DRAFT",
          program: buildMinimalSignalProgram({ expandedText, fingerprint: fixtureFingerprint, rawInput: fixtureSeed }),
        },
      });
      phase("SERIALIZE");
      return { staged: command.marker, id: signal.id, attemptId: fence.attemptId, ownerId: fence.ownerId,
        attemptCount: fence.attemptCount, leaseUntil: fence.leaseUntil.toISOString(), deadlineAt: fence.deadlineAt.toISOString(),
        phase: "WRITING" } satisfies GenerationStageResult;
    }
    if (command.kind === "complete" || command.kind === "fail") {
      phase(command.kind === "complete" ? "COMPLETE" : "FAIL");
      if (generationRepository === undefined) throw new Error("Repository writes are forbidden in consumer cases.");
      const writer = staged.get(command.marker);
      if (!writer) throw new Error("Generation writer was not staged.");
      staged.delete(command.marker);
      const result = command.kind === "complete"
        ? await generationRepository.completeOwnedSignalGeneration({ fence: writer.fence, output: writer.output })
        : await generationRepository.failOwnedSignalGeneration({ fence: writer.fence, code: "GENERATION_FAILED" });
      return { accepted: result.outcome === "APPLIED", outcome: result.outcome } satisfies GenerationWriteResult;
    }
    closing = true;
    phase("SHUTDOWN");
    await app.close();
    return { blockedHttp, unhandled, pendingHttp, abortedHttp } satisfies GenerationShutdownDiagnostics;
  }

  process.on("message", (input: unknown) => {
    const parsed = messageSchema.safeParse(input);
    if (!parsed.success || JSON.stringify(input).length > 16_384) {
      void send({ kind: "fatal", error: "INVALID_GENERATION_COMMAND" }).finally(() => process.exit(1));
      return;
    }
    const { id, command } = parsed.data;
    void (async () => {
      let phase: CommandPhase = "START";
      try {
        const value = await execute(command, (value) => { phase = value; });
        await send({ kind: "reply", id, ok: true, value });
        if (command.kind === "shutdown") {
          globalThis.fetch = originalFetch;
          process.removeListener("unhandledRejection", fatal);
          process.removeListener("uncaughtException", fatal);
          process.disconnect?.();
        }
      } catch (error) {
        const category = error instanceof TypeError ? "TYPE" : error instanceof Error && error.name === "PostgresError" ? "DATABASE" : "OTHER";
        await send({ kind: "reply", id, ok: false, error: `GENERATION_COMMAND_FAILED:${phase}:${category}` });
      }
    })();
  });
  await send({ kind: "ready", pid: process.pid });
}

// The coordinator imports only this module's types. Executing it requires its
// private IPC channel and the full managed ownership/environment handshake.
if (process.env.UNFREQ_GENERATION_FIXTURE === "1" && process.send) {
  void main().catch(async () => {
    try { await send({ kind: "fatal", error: "GENERATION_BOOT_FAILED" }); }
    finally { process.exit(1); }
  });
}
