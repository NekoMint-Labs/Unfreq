import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import {
  GenerationExecutionStopped,
  runWithGenerationExecution,
  type GenerationExecutionContext,
} from "../../shared/generation-execution.js";
import type { EmbeddingLogger } from "../ai/embedding.js";
import {
  configureSignalGenerationRepository,
  GenerationInputUnavailableError,
  type SignalGenerationRepository,
} from "./generation-repository.js";
import type { GenerationClaim, GenerationFailureCode, RunningGenerationPhase } from "./generation-types.js";
import { generateOwnedSignalOutput } from "./service-creation.js";

export type GenerationWorkerConfig = {
  enabled: boolean;
  concurrency: number;
  scanIntervalMs: number;
  leaseMs: number;
  heartbeatMs: number;
  attemptTimeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  shutdownGraceMs: number;
  dbStatementTimeoutMs: number;
  dbLockTimeoutMs: number;
};

export type SignalGenerationWorker = {
  readonly accepting: boolean;
  readonly activeCount: number;
  start(): void;
  wake(): void;
  stop(): Promise<void>;
};

type ActiveAttempt = {
  claim: GenerationClaim;
  controller: AbortController;
  promise: Promise<void>;
};

export type GenerationWorkerOptions = {
  config?: GenerationWorkerConfig;
  repository?: SignalGenerationRepository;
  execute?: typeof generateOwnedSignalOutput;
  logger?: EmbeddingLogger;
  ownerId?: string;
  forceCloseApplicationDatabase?: () => Promise<void>;
  onFatal?: () => void | Promise<void>;
};

export function generationWorkerConfigFromEnvironment(): GenerationWorkerConfig {
  return {
    enabled: env.signalGenerationWorkerEnabled,
    concurrency: env.signalGenerationConcurrency,
    scanIntervalMs: env.signalGenerationScanIntervalMs,
    leaseMs: env.signalGenerationLeaseMs,
    heartbeatMs: env.signalGenerationHeartbeatMs,
    attemptTimeoutMs: env.signalGenerationAttemptTimeoutMs,
    maxAttempts: env.signalGenerationMaxAttempts,
    retryBaseMs: env.signalGenerationRetryBaseMs,
    retryMaxMs: env.signalGenerationRetryMaxMs,
    shutdownGraceMs: env.signalGenerationShutdownGraceMs,
    dbStatementTimeoutMs: env.signalGenerationDbStatementTimeoutMs,
    dbLockTimeoutMs: env.signalGenerationDbLockTimeoutMs,
  };
}

function validateConfig(config: GenerationWorkerConfig) {
  for (const [key, value] of Object.entries(config)) {
    if (key !== "enabled" && (!Number.isSafeInteger(value) || Number(value) <= 0)) {
      throw new Error("Invalid generation worker timing or capacity.");
    }
  }
  if (typeof config.enabled !== "boolean" || config.heartbeatMs * 2 >= config.leaseMs ||
      config.leaseMs > config.attemptTimeoutMs || config.retryBaseMs > config.retryMaxMs ||
      config.dbLockTimeoutMs >= config.dbStatementTimeoutMs) {
    throw new Error("Inconsistent generation worker configuration.");
  }
}

// This only observes a drain budget. It neither cancels work nor releases a
// slot. Escalation below closes the actual resources and awaits them again.
async function settledWithin(work: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function createSignalGenerationWorker(options: GenerationWorkerOptions = {}): SignalGenerationWorker {
  const config = options.config ?? generationWorkerConfigFromEnvironment();
  validateConfig(config);
  const repository = options.repository ?? configureSignalGenerationRepository({
    statementTimeoutMs: config.dbStatementTimeoutMs,
    lockTimeoutMs: config.dbLockTimeoutMs,
    maxConnections: 2,
  });
  const execute = options.execute ?? generateOwnedSignalOutput;
  const ownerId = options.ownerId ?? randomUUID();
  const active = new Map<string, ActiveAttempt>();
  const ioDrainBudgetMs = config.dbStatementTimeoutMs + config.dbLockTimeoutMs + 1000;
  let started = false;
  let stopping = false;
  let fatal = false;
  let timer: NodeJS.Timeout | undefined;
  let scanPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let wakePending = false;

  const backoffForAttempt = (attempt: number) => Math.min(config.retryMaxMs,
    config.retryBaseMs * 2 ** Math.min(20, Math.max(0, attempt - 1)));
  const warn = (action: string, claim?: GenerationClaim) => options.logger?.warn({
    action,
    ...(claim === undefined ? {} : { targetId: claim.signalId, attemptId: claim.attemptId, attemptCount: claim.attemptCount }),
    targetType: "SIGNAL",
  }, "signal generation requires recovery");

  function requestFatalRecovery() {
    if (fatal) return;
    fatal = true;
    if (timer !== undefined) clearTimeout(timer);
    warn("signal.generation.fatal_io");
    // The application owns process shutdown/restart. No successful drain is
    // reported if a known I/O operation cannot actually be stopped.
    const closing = options.onFatal === undefined ? stop() : Promise.resolve().then(options.onFatal);
    void closing.catch(() => warn("signal.generation.fatal_shutdown_failed"));
  }

  async function handleFailure(attempt: ActiveAttempt, error: unknown, dispatched: boolean) {
    const claim = attempt.claim;
    try {
      // A lost completion reply must not trigger another generation. This
      // query intentionally does not require an active owner/lease.
      const outcome = await repository.findGenerationAttemptOutcome(claim);
      if (outcome === "COMPLETED" || outcome === "FAILED" || outcome === "OBSOLETE") return;
      if (error instanceof GenerationExecutionStopped && error.reason === "obsolete") return;

      if (error instanceof AbuseControlStopped) {
        // An explicit budget denial is a known stop, not a Provider failure.
        // Never retry it or run a cheaper/local fallback after an accepted 201.
        await repository.failOwnedSignalGeneration({ fence: claim,
          code: error.reason === "limited" ? "GENERATION_RATE_LIMITED" : "GENERATION_PROTECTION_UNAVAILABLE" });
        return;
      }

      const deterministic = error instanceof GenerationInputUnavailableError ||
        (error instanceof AppError && ["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "CONFLICT"].includes(error.code));
      const stopReason = attempt.controller.signal.reason;
      const deadline = (error instanceof GenerationExecutionStopped && error.reason === "deadline") ||
        (stopReason instanceof GenerationExecutionStopped && stopReason.reason === "deadline");
      const storageUncertain = (error instanceof GenerationExecutionStopped && error.reason === "storage-uncertain") ||
        (stopReason instanceof GenerationExecutionStopped && stopReason.reason === "storage-uncertain");

      if (!dispatched && !deterministic && !deadline && claim.attemptCount < config.maxAttempts) {
        const retried = await repository.requeueUndispatchedSignalGeneration({
          fence: claim, maxAttempts: config.maxAttempts,
          backoffMs: stopping ? 0 : backoffForAttempt(claim.attemptCount),
        });
        if (retried.outcome === "APPLIED") return;
        // A missing reply for markDispatch can leave a persisted dispatch
        // marker although the local flag is false. The repository refuses to
        // retry that shape; its expired lease must settle the unknown outcome.
        return;
      }
      const code: GenerationFailureCode = dispatched || storageUncertain ? "GENERATION_OUTCOME_UNKNOWN" :
        deadline ? "GENERATION_TIMEOUT" : deterministic ? "GENERATION_FAILED" : "GENERATION_RETRY_EXHAUSTED";
      const failed = await repository.failOwnedSignalGeneration({ fence: claim, code });
      if (failed.outcome === "APPLIED") options.logger?.warn({
        action: "signal.generation.failed", targetId: claim.signalId,
        attemptId: claim.attemptId, attemptCount: claim.attemptCount,
        failureCode: code, generationStatus: "FAILED", targetType: "SIGNAL",
      }, "signal generation failed");
    } catch {
      // No unconditional late FAILED update. Persisted leases are the recovery
      // authority if storage or a commit acknowledgement is unavailable.
      warn("signal.generation.outcome_unconfirmed", claim);
    }
  }

  async function runAttempt(attempt: ActiveAttempt) {
    const claim = attempt.claim;
    const controller = attempt.controller;
    let phase: RunningGenerationPhase = "EXPANDING";
    let dispatched = false;
    let finishing = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeatPromise: Promise<void> | undefined;
    let ioWatchdog: NodeJS.Timeout | undefined;
    const assertNotStopped = () => {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof GenerationExecutionStopped
          ? controller.signal.reason : new GenerationExecutionStopped("aborted");
      }
    };
    const abort = (reason: "obsolete" | "deadline" | "storage-uncertain") => {
      if (!controller.signal.aborted) controller.abort(new GenerationExecutionStopped(reason));
    };
    const deadlineTimer = setTimeout(() => {
      abort("deadline");
      // An abort signal cannot interrupt arbitrary database I/O. If the real
      // subwork still has not settled, fail closed and close the application.
      ioWatchdog = setTimeout(() => {
        if (active.has(claim.attemptId)) requestFatalRecovery();
      }, ioDrainBudgetMs);
      ioWatchdog.unref();
    }, Math.max(1, Math.min(config.attemptTimeoutMs, claim.remainingMs)));
    deadlineTimer.unref();

    const scheduleHeartbeat = () => {
      if (finishing || controller.signal.aborted) return;
      heartbeatTimer = setTimeout(() => {
        heartbeatPromise = repository.renewSignalGenerationLease({ fence: claim, leaseMs: config.leaseMs })
          .then((result) => { if (!finishing && result.outcome === "OBSOLETE") abort("obsolete"); })
          .catch(() => { if (!finishing) abort("storage-uncertain"); })
          .finally(scheduleHeartbeat);
      }, config.heartbeatMs);
      heartbeatTimer.unref();
    };
    const context: GenerationExecutionContext = {
      attemptId: claim.attemptId,
      signal: controller.signal,
      async assertActive() {
        assertNotStopped();
        if (!(await repository.isSignalGenerationAttemptActive(claim))) throw new GenerationExecutionStopped("obsolete");
        assertNotStopped();
      },
      async beforeDispatch(meta) {
        assertNotStopped();
        const result = await repository.markSignalGenerationDispatch(claim);
        if (result.outcome === "OBSOLETE") throw new GenerationExecutionStopped("obsolete");
        dispatched = true;
        assertNotStopped();
        options.logger?.info({
          action: "signal.generation.dispatch", targetId: claim.signalId,
          attemptId: claim.attemptId, providerKind: meta.kind, stage: meta.stage,
        }, "signal generation dispatch");
      },
    };
    scheduleHeartbeat();
    try {
      const input = await repository.readOwnedSignalGenerationInput(claim);
      if (input.outcome === "OBSOLETE") throw new GenerationExecutionStopped("obsolete");
      await runWithGenerationExecution(context, async () => {
        await context.assertActive();
        const output = await execute({
          ...input.value,
          logger: options.logger,
          async onGenerationStatusChange(status) {
            assertNotStopped();
            const result = await repository.advanceSignalGenerationPhase({ fence: claim, from: phase, to: status });
            if (result.outcome === "OBSOLETE") throw new GenerationExecutionStopped("obsolete");
            phase = status;
          },
        });
        await context.assertActive();
        const result = await repository.completeOwnedSignalGeneration({ fence: claim, output });
        if (result.outcome === "OBSOLETE") throw new GenerationExecutionStopped("obsolete");
        options.logger?.info({
          action: "signal.generation.completed", targetId: claim.signalId,
          attemptId: claim.attemptId, attemptCount: claim.attemptCount,
          generationStatus: "COMPLETED", targetType: "SIGNAL",
        }, "signal generation completed");
      });
    } catch (error) {
      await handleFailure(attempt, error, dispatched);
    } finally {
      finishing = true;
      if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
      try { if (heartbeatPromise !== undefined) await heartbeatPromise; }
      finally {
        clearTimeout(deadlineTimer);
        if (ioWatchdog !== undefined) clearTimeout(ioWatchdog);
      }
    }
  }

  function launch(claim: GenerationClaim) {
    const attempt: ActiveAttempt = { claim, controller: new AbortController(), promise: Promise.resolve() };
    active.set(claim.attemptId, attempt);
    attempt.promise = runAttempt(attempt).catch(() => warn("signal.generation.execution_failed", claim)).finally(() => {
      active.delete(claim.attemptId);
      wake();
    });
  }

  async function scan() {
    if (!started || stopping || fatal) return;
    await repository.recoverExpiredSignalGenerations({
      batchSize: Math.max(4, config.concurrency * 2), maxAttempts: config.maxAttempts, backoffForAttempt,
    });
    if (stopping || fatal || active.size >= config.concurrency) return;
    const claims = await repository.claimSignalGenerationBatch({
      ownerId, globalCapacity: config.concurrency, localAvailable: config.concurrency - active.size,
      leaseMs: config.leaseMs, attemptTimeoutMs: config.attemptTimeoutMs, maxAttempts: config.maxAttempts,
    });
    for (const claim of claims) {
      if (stopping || fatal) {
        await repository.requeueUndispatchedSignalGeneration({ fence: claim, maxAttempts: config.maxAttempts, backoffMs: 0 });
      } else launch(claim);
    }
  }

  function wake() {
    if (!started || stopping || fatal || !config.enabled) return;
    if (timer !== undefined) clearTimeout(timer);
    if (scanPromise !== undefined) { wakePending = true; return; }
    const scanWatchdog = setTimeout(requestFatalRecovery, ioDrainBudgetMs);
    scanWatchdog.unref();
    scanPromise = Promise.resolve().then(scan).catch(() => warn("signal.generation.scan_paused")).finally(() => {
      clearTimeout(scanWatchdog);
      scanPromise = undefined;
      if (stopping || fatal) return;
      timer = setTimeout(wake, wakePending ? 0 : config.scanIntervalMs);
      wakePending = false;
      timer.unref();
    });
  }

  async function settleCurrentWork() {
    while (scanPromise !== undefined || active.size !== 0) {
      await Promise.allSettled([
        ...(scanPromise === undefined ? [] : [scanPromise]),
        ...[...active.values()].map((attempt) => attempt.promise),
      ]);
    }
  }

  function stop(): Promise<void> {
    stopPromise ??= (async () => {
      stopping = true;
      if (timer !== undefined) clearTimeout(timer);
      const drained = settleCurrentWork();
      if (!(await settledWithin(drained, fatal ? 0 : config.shutdownGraceMs))) {
        for (const attempt of active.values()) {
          if (!attempt.controller.signal.aborted) attempt.controller.abort(new GenerationExecutionStopped("shutdown"));
        }
        if (!(await settledWithin(drained, ioDrainBudgetMs))) {
          const closed = await Promise.allSettled([
            repository.closeSignalGenerationRepository({ timeoutSeconds: 0 }),
            ...(options.forceCloseApplicationDatabase === undefined ? [] : [options.forceCloseApplicationDatabase()]),
          ]);
          if (closed.some((result) => result.status === "rejected")) warn("signal.generation.pool_close_failed");
          if (!(await settledWithin(drained, ioDrainBudgetMs))) {
            // The server must exit nonzero rather than report a successful
            // shutdown with live work. Its independent exit watchdog enforces it.
            throw new Error("Generation work did not drain after closing its resources; process exit is required.");
          }
        }
      }
      await repository.closeSignalGenerationRepository({ timeoutSeconds: 0 });
    })();
    return stopPromise;
  }

  return {
    get accepting() { return config.enabled && started && !stopping && !fatal; },
    get activeCount() { return active.size; },
    start() {
      if (started || stopping) return;
      started = true;
      if (config.enabled) wake();
    },
    wake,
    stop,
  };
}
