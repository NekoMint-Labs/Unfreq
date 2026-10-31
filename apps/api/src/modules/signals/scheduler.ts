import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { GenerationExecutionStopped, runWithGenerationExecution } from "../../shared/generation-execution.js";
import type { EmbeddingLogger } from "../ai/embedding.js";
import { generateAiSignals } from "./service-generated.js";
import { configureAiSignalSchedulerRepository } from "./scheduler-repository.js";
import { isSupportedSchedulerTimeZone, schedulerBusinessTime } from "./scheduler-time.js";
import type { AiSignalSchedulerConfig, AiSignalSchedulerRepository, SchedulerBatchClaim, SchedulerBatchFinish, SchedulerBatchProgress, SchedulerRunResult } from "./scheduler-types.js";

export type { AiSignalSchedulerConfig } from "./scheduler-types.js";
export type AiSignalSchedulerOptions = {
  config?: AiSignalSchedulerConfig;
  repository?: AiSignalSchedulerRepository;
  execute?: typeof generateAiSignals;
  logger?: EmbeddingLogger;
  now?: () => Date;
  forceCloseApplicationDatabase?: () => Promise<void>;
  onFatal?: () => void | Promise<void>;
};
export type AiSignalScheduler = {
  start(): void;
  runDue(now?: Date): Promise<SchedulerRunResult>;
  stop(): Promise<void>;
};

class SchedulerStopped extends GenerationExecutionStopped {
  constructor(readonly code: NonNullable<SchedulerBatchFinish["failureCode"]>) {
    super(code === "SHUTDOWN" ? "shutdown" : code === "DEADLINE" ? "deadline" : code === "OWNERSHIP_LOST" ? "obsolete" : "aborted");
  }
}

export function aiSignalSchedulerConfigFromEnvironment(): AiSignalSchedulerConfig {
  return {
    enabled: env.aiSignalSchedulerEnabled, timeZone: env.aiSignalSchedulerTimeZone, scheduledTime: env.aiSignalSchedulerTime,
    count: env.aiSignalSchedulerCount, dailySignalBudget: env.aiSignalSchedulerDailySignalBudget,
    dailyDispatchBudget: env.aiSignalSchedulerDailyDispatchBudget, pollIntervalMs: env.aiSignalSchedulerPollIntervalMs,
    batchTimeoutMs: env.aiSignalSchedulerBatchTimeoutMs, shutdownGraceMs: env.aiSignalSchedulerShutdownGraceMs,
    dbStatementTimeoutMs: env.signalGenerationDbStatementTimeoutMs, dbLockTimeoutMs: env.signalGenerationDbLockTimeoutMs,
  };
}

function validateConfig(config: AiSignalSchedulerConfig) {
  const positive = [config.count, config.dailySignalBudget, config.dailyDispatchBudget, config.pollIntervalMs,
    config.batchTimeoutMs, config.shutdownGraceMs, config.dbStatementTimeoutMs, config.dbLockTimeoutMs];
  if (typeof config.enabled !== "boolean" || positive.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      config.count > 10 || config.dailySignalBudget > 10 || config.count > config.dailySignalBudget || config.dailyDispatchBudget > 500 ||
      !isSupportedSchedulerTimeZone(config.timeZone) || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(config.scheduledTime) ||
      config.dbLockTimeoutMs >= config.dbStatementTimeoutMs) throw new Error("Invalid AI signal scheduler configuration.");
}

async function settlesWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([work.then(() => true, () => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export function createAiSignalScheduler(options: AiSignalSchedulerOptions = {}): AiSignalScheduler {
  const config = options.config ?? aiSignalSchedulerConfigFromEnvironment();
  validateConfig(config);
  const repository = options.repository ?? configureAiSignalSchedulerRepository(config);
  const execute = options.execute ?? generateAiSignals;
  const now = options.now ?? (() => new Date());
  let started = false;
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<SchedulerRunResult> | undefined;
  let controller: AbortController | undefined;
  let stopPromise: Promise<void> | undefined;

  const warn = (action: string, claim?: SchedulerBatchClaim, code?: string) => options.logger?.warn({
    action, ...(claim ? { batchId: claim.id, businessDate: claim.businessDate } : {}), ...(code ? { code } : {}),
  }, "AI signal scheduler requires attention");

  async function runBatch(businessDate: string, abort: AbortController): Promise<SchedulerRunResult> {
    let claim: SchedulerBatchClaim | undefined;
    let progress: SchedulerBatchProgress = { accepted: 0, rejected: 0, attempts: 0, signalIds: [] };
    let fatalTimer: NodeJS.Timeout | undefined;
    const checkAbort = () => { if (abort.signal.aborted) throw abort.signal.reason; };
    const deadlineTimer = setTimeout(() => {
      abort.abort(new SchedulerStopped("DEADLINE"));
      // A deadline is cancellation, not proof that underlying I/O has drained.
      fatalTimer = setTimeout(() => {
        warn("signal.ai_scheduler.deadline_io_not_drained", claim, "DEADLINE");
        const closing = options.onFatal ? Promise.resolve().then(options.onFatal) : stop();
        void closing.catch(() => warn("signal.ai_scheduler.fatal_shutdown_failed", claim));
      }, config.shutdownGraceMs);
      fatalTimer.unref();
    }, config.batchTimeoutMs);
    deadlineTimer.unref();
    try {
      checkAbort();
      claim = await repository.claim({ businessDate, ownerToken: randomUUID(), config });
      if (!claim) return { status: "already-claimed", businessDate };
      const owned = claim;
      const assertActive = async () => {
        checkAbort();
        if (!await repository.isActive(owned)) throw new SchedulerStopped("OWNERSHIP_LOST");
        checkAbort();
      };
      checkAbort();
      const summary = await runWithGenerationExecution({
        attemptId: owned.ownerToken, signal: abort.signal, assertActive,
        async beforeDispatch() {
          checkAbort();
          const reserved = await repository.reserveDispatch(owned);
          checkAbort();
          if (reserved !== "reserved") throw new SchedulerStopped(reserved === "budget" ? "BUDGET_EXHAUSTED" : "OWNERSHIP_LOST");
        },
      }, () => execute({
        count: owned.requestedCount, businessDate, syncEmbedding: true, logger: options.logger,
        async onProgress(current) {
          progress = { accepted: current.accepted, rejected: current.rejected, attempts: current.attempts, signalIds: current.results.map((item) => item.signal.id) };
          checkAbort();
          if (!await repository.recordProgress(owned, progress)) throw new SchedulerStopped("OWNERSHIP_LOST");
          checkAbort();
        },
      }));
      await assertActive();
      progress = { accepted: summary.accepted, rejected: summary.rejected, attempts: summary.attempts, signalIds: summary.results.map((item) => item.signal.id) };
      if (!await repository.finish(owned, { ...progress, status: "COMPLETED" })) throw new SchedulerStopped("OWNERSHIP_LOST");
      options.logger?.info({ action: "signal.ai_scheduler.completed", batchId: owned.id, businessDate,
        accepted: progress.accepted, rejected: progress.rejected, attempts: progress.attempts }, "AI signal scheduled batch completed");
      return { status: "completed", businessDate };
    } catch (error) {
      const code = error instanceof SchedulerStopped ? error.code :
        error instanceof GenerationExecutionStopped ? (error.reason === "shutdown" ? "SHUTDOWN" : error.reason === "deadline" ? "DEADLINE" : "OWNERSHIP_LOST") : "EXECUTION_FAILED";
      if (claim) {
        try { await repository.finish(claim, { ...progress, status: code === "SHUTDOWN" ? "CANCELLED" : "FAILED", failureCode: code }); }
        catch { warn("signal.ai_scheduler.finish_uncertain", claim, code); }
      }
      warn("signal.ai_scheduler.batch_stopped", claim, code);
      return { status: code === "SHUTDOWN" ? "cancelled" : "failed", businessDate };
    } finally {
      clearTimeout(deadlineTimer);
      if (fatalTimer !== undefined) clearTimeout(fatalTimer);
    }
  }

  function runDue(at = now()): Promise<SchedulerRunResult> {
    if (stopping) return Promise.resolve({ status: "stopped" });
    if (!config.enabled) return Promise.resolve({ status: "disabled" });
    if (active) return active;
    const business = schedulerBusinessTime(at, config.timeZone);
    if (business.time < config.scheduledTime) return Promise.resolve({ status: "not-due", businessDate: business.businessDate });
    controller = new AbortController();
    active = runBatch(business.businessDate, controller).finally(() => { active = undefined; controller = undefined; });
    return active;
  }

  function start() {
    if (started || stopping || !config.enabled) return;
    started = true;
    const tick = async () => {
      try { await runDue(); } catch { warn("signal.ai_scheduler.scan_failed"); }
      if (!stopping) { timer = setTimeout(() => { void tick(); }, config.pollIntervalMs); timer.unref(); }
    };
    void tick();
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (timer !== undefined) clearTimeout(timer);
    controller?.abort(new SchedulerStopped("SHUTDOWN"));
    stopPromise = (async () => {
      const draining = active;
      if (draining && !await settlesWithin(draining, config.shutdownGraceMs)) {
        warn("signal.ai_scheduler.shutdown_force_io");
        // These close real sockets/queries, not just the observation promise.
        const closed = await Promise.allSettled([repository.close(true), options.forceCloseApplicationDatabase?.()]);
        if (closed.some((result) => result.status === "rejected") || !await settlesWithin(draining, config.dbStatementTimeoutMs + 1000)) {
          throw new Error("AI signal scheduler did not drain; process recovery required.");
        }
      }
      if (draining) await draining;
      await repository.close();
    })();
    return stopPromise;
  }
  return { start, runDue, stop };
}
