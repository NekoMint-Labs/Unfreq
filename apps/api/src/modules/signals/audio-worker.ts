import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { env } from "../../config/env.js";
import { getAbuseGuard, type AbuseConcurrencyLease, type AbuseGuard, type AbuseReservation } from "../../shared/abuse-control.js";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { AppError } from "../../shared/errors.js";
import { apiShutdownBudgetMs } from "../../shared/shutdown-budget.js";
import { isTtsProviderConfigured, synthesize, type TtsLogger } from "../ai/tts.js";
import { createSignalAudioRepository, type AudioAttempt, type AudioFailureCode, type SignalAudioRepository } from "./audio-repository.js";
import { buildSignalAudioStorageKey, removeSignalAudio, writeSignalAudio } from "./audio-storage.js";
import { toSignalAudioDetail, toUnavailableTtsAudioDetail } from "./service-mappers.js";
import type { SignalAudioDetail, SignalRecord } from "./types.js";

export type SignalAudioWorker = {
  readonly accepting: boolean;
  request(signal: SignalRecord | string, clientIp: string, logger?: TtsLogger): Promise<SignalAudioDetail>;
  stop(): Promise<void>;
};
export type SignalAudioWorkerOptions = {
  repository?: SignalAudioRepository;
  guard?: AbuseGuard;
  isProviderConfigured?: typeof isTtsProviderConfigured;
  synthesize?: typeof synthesize;
  writeAudio?: typeof writeSignalAudio;
  removeAudio?: typeof removeSignalAudio;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  closeTimeoutMs?: number;
  /** The app passes the same whole-server exit budget used by its watchdog. */
  shutdownBudgetMs?: number;
  logger?: TtsLogger;
  forceCloseApplicationDatabase?: () => Promise<void>;
  onFatal?: () => void | Promise<void>;
};

class AudioTaskStopped extends Error {
  constructor(readonly reason: "shutdown" | "deadline" | "obsolete") {
    super("Audio execution stopped.");
    this.name = "AbortError";
  }
}
const unavailable = () => new AbuseControlStopped("unavailable", "storage");

// Observes a budget only: the task remains tracked and holds its lease.
async function settledWithin(work: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work.then(() => true), new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), milliseconds);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

type AudioTask = {
  controller: AbortController;
  promise: Promise<void>;
  attempt?: AudioAttempt;
  reservation?: AbuseReservation;
  lease?: AbuseConcurrencyLease;
  commitStarted: boolean;
  ready: boolean;
  readyUncertain: boolean;
  fileCreated: boolean;
  storageKey?: string;
  resolve(value: SignalAudioDetail): void;
  reject(error: unknown): void;
  responded: boolean;
  deadlineTimer?: NodeJS.Timeout;
  ioWatchdog?: NodeJS.Timeout;
  deadlineAt?: number;
};

export function createSignalAudioWorker(options: SignalAudioWorkerOptions = {}): SignalAudioWorker {
  const guard = options.guard ?? getAbuseGuard();
  const statementTimeoutMs = options.statementTimeoutMs ?? env.signalGenerationDbStatementTimeoutMs;
  const lockTimeoutMs = options.lockTimeoutMs ?? env.signalGenerationDbLockTimeoutMs;
  const closeTimeoutMs = options.closeTimeoutMs ?? 1000;
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0 ||
      !Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs <= 0 || lockTimeoutMs >= statementTimeoutMs ||
      !Number.isSafeInteger(closeTimeoutMs) || closeTimeoutMs <= 0 || closeTimeoutMs > 2_147_483_647) {
    throw new Error("Invalid audio worker I/O configuration.");
  }
  const ioBudgetMs = statementTimeoutMs + lockTimeoutMs + closeTimeoutMs;
  if (!Number.isSafeInteger(ioBudgetMs) || ioBudgetMs > 1_073_741_823) throw new Error("Invalid audio drain budget.");
  const shutdownBudgetMs = options.shutdownBudgetMs ?? apiShutdownBudgetMs(env);
  const drainMs = 2 * ioBudgetMs + shutdownBudgetMs;
  if (!Number.isSafeInteger(shutdownBudgetMs) || shutdownBudgetMs <= 0 ||
      !Number.isSafeInteger(drainMs) || drainMs > 2_147_483_647) throw new Error("Invalid audio shutdown/lease drain budget.");
  const repository = options.repository ?? createSignalAudioRepository({ statementTimeoutMs, lockTimeoutMs });
  const providerConfigured = options.isProviderConfigured ?? isTtsProviderConfigured;
  const synthesizeAudio = options.synthesize ?? synthesize;
  const writeAudio = options.writeAudio ?? writeSignalAudio;
  const removeAudio = options.removeAudio ?? removeSignalAudio;
  const active = new Map<string, AudioTask>();
  let stopping = false;
  let fatal = false;
  let stopPromise: Promise<void> | undefined;

  function warn(action: string, task?: AudioTask, logger = options.logger) {
    logger?.warn({ action, targetType: "SIGNAL", ...(task?.attempt === undefined ? {} : {
      targetId: task.attempt.signal.id, attemptId: task.attempt.attemptId,
    }) }, "signal audio requires recovery");
  }
  function requestFatal() {
    if (fatal) return;
    fatal = true;
    warn("signal.audio.fatal_io");
    const closing = options.onFatal === undefined ? stop() : Promise.resolve().then(options.onFatal);
    void closing.catch(() => warn("signal.audio.fatal_shutdown_failed"));
  }
  function check(task: AudioTask) {
    if (!task.controller.signal.aborted && task.deadlineAt !== undefined && performance.now() >= task.deadlineAt) {
      task.controller.abort(new AudioTaskStopped("deadline"));
    }
    if (task.controller.signal.aborted) throw task.controller.signal.reason;
  }
  async function assertOwnership(task: AudioTask) {
    check(task);
    if (task.lease === undefined || task.attempt === undefined) throw unavailable();
    await task.lease.assertActive();
    check(task);
    if (!(await repository.isOwnedPublic(task.attempt))) throw new AudioTaskStopped("obsolete");
    check(task);
  }

  async function cleanupFailure(task: AudioTask, error: unknown, logger?: TtsLogger): Promise<unknown> {
    let uncertain = task.readyUncertain || (error instanceof AbuseControlStopped &&
      error.reason === "unavailable" && error.rule === "storage");
    if (task.readyUncertain && task.attempt !== undefined && task.storageKey !== undefined) {
      try {
        if (await repository.outcome(task.attempt, task.storageKey) === "READY") {
          task.ready = true;
          return undefined;
        }
      } catch { /* An unconfirmed READY can still reference this file. */ }
    }
    let failed = false;
    if (task.attempt !== undefined && !task.ready) {
      const code: AudioFailureCode = error instanceof AbuseControlStopped
        ? error.statusCode === 429 ? "AUDIO_RATE_LIMITED" : "AUDIO_PROTECTION_UNAVAILABLE"
        : error instanceof AudioTaskStopped ? "AUDIO_CANCELLED" : "AUDIO_UNAVAILABLE";
      try { failed = await repository.failed(task.attempt, code); }
      catch { uncertain = true; }
    }
    // Only known pre-commit failure refunds. Lost commit replies, uncertain
    // SQL and all committed jobs retain their charge; no guessed refund.
    if (failed && !uncertain && !task.commitStarted && task.reservation !== undefined) {
      try { await task.reservation.refund(); } catch { uncertain = true; }
    }
    if (task.fileCreated && task.storageKey !== undefined && !task.ready && !uncertain) {
      try {
        if (!(await repository.isFileReferenced(task.storageKey))) await removeAudio(task.storageKey);
      } catch { warn("signal.audio.file_cleanup_unconfirmed", task, logger); }
    }
    warn(uncertain ? "signal.audio.outcome_unconfirmed" : "signal.audio.failed", task, logger);
    if (uncertain) return unavailable();
    return error instanceof AppError ? error : new AbuseControlStopped("unavailable", "concurrency");
  }

  async function runTask(task: AudioTask, id: string, clientIp: string, logger?: TtsLogger) {
    let failure: unknown;
    const startedAt = performance.now();
    const timeoutMs = guard.policy.ttsTaskTimeoutMs;
    task.deadlineAt = startedAt + timeoutMs;
    task.deadlineTimer = setTimeout(() => {
      if (!task.controller.signal.aborted) task.controller.abort(new AudioTaskStopped("deadline"));
      task.ioWatchdog = setTimeout(() => { if (!stopping) requestFatal(); }, ioBudgetMs);
      task.ioWatchdog.unref();
    }, timeoutMs);
    task.deadlineTimer.unref();
    try {
      const signal = await repository.readPublished(id);
      check(task);
      if (signal === undefined) throw new AppError("NOT_FOUND", "Signal not found.");
      if (signal.audioStatus === "READY" || signal.audioStatus === "PENDING") {
        task.resolve(toSignalAudioDetail(signal));
        return;
      }
      const configured = await providerConfigured();
      check(task);
      if (!configured) {
        const fallback = await repository.markUnavailable(id);
        check(task);
        if (fallback === undefined) throw new AppError("NOT_FOUND", "Signal not found.");
        task.resolve(fallback.audioStatus === "READY" || fallback.audioStatus === "PENDING"
          ? toSignalAudioDetail(fallback) : toUnavailableTtsAudioDetail(fallback));
        return;
      }
      if (!guard.policy.configured) throw new AbuseControlStopped("unavailable", "configuration");
      const claimed = await repository.claim(id);
      if (claimed.outcome === "CLAIMED") task.attempt = claimed.attempt;
      check(task);
      if (claimed.outcome === "UNAVAILABLE") throw new AppError("NOT_FOUND", "Signal not found.");
      if (claimed.outcome === "CACHED") { task.resolve(toSignalAudioDetail(claimed.signal)); return; }
      task.storageKey = buildSignalAudioStorageKey(id, "main", claimed.attempt.attemptId);
      task.reservation = await guard.reserve([
        { rule: "audioNewIp", identity: clientIp }, { rule: "audioNewDailySite", identity: "site" },
      ]);
      check(task);
      const remaining = Math.max(1, Math.floor(timeoutMs - (performance.now() - startedAt)));
      task.lease = await guard.acquireConcurrency("tts", guard.policy.ttsConcurrency, remaining, drainMs);
      await assertOwnership(task);
      task.commitStarted = true;
      if (await task.reservation.commit() !== "COMMITTED") throw unavailable();
      check(task);
      task.resolve(toSignalAudioDetail(claimed.attempt.signal));
      const audio = await synthesizeAudio(claimed.attempt.signal.expandedText, undefined, 0.96, {
        logger, signal: task.controller.signal,
        totalTimeoutMs: Math.max(1, Math.floor(timeoutMs - (performance.now() - startedAt))),
        closeTimeoutMs,
        beforeDispatch: () => assertOwnership(task),
      });
      await assertOwnership(task);
      await writeAudio(task.storageKey, audio, { signal: task.controller.signal,
        onCreated: () => { task.fileCreated = true; },
      });
      task.fileCreated = true;
      await assertOwnership(task);
      task.readyUncertain = true;
      const written = await repository.ready(claimed.attempt, task.storageKey, `/api/signals/${id}/audio/main`);
      task.readyUncertain = false;
      if (!written) throw new AudioTaskStopped("obsolete");
      task.ready = true;
      logger?.info({ action: "signal.audio.completed", targetId: id, attemptId: claimed.attempt.attemptId,
        targetType: "SIGNAL" }, "signal audio generation completed");
    } catch (error) { failure = await cleanupFailure(task, error, logger); }
    finally {
      // A slot is released only after actual synthesis/socket/file/SQL work has
      // settled. Redis expiry alone does not prove remote computation stopped.
      try { await task.lease?.release(); }
      catch { failure = unavailable(); warn("signal.audio.lease_release_unconfirmed", task, logger); }
      if (task.deadlineTimer !== undefined) clearTimeout(task.deadlineTimer);
      if (task.ioWatchdog !== undefined) clearTimeout(task.ioWatchdog);
    }
    if (!task.responded) task.reject(failure ?? unavailable());
  }

  async function settleWork() {
    while (active.size !== 0) await Promise.allSettled([...active.values()].map((task) => task.promise));
  }
  function stop(): Promise<void> {
    stopPromise ??= (async () => {
      stopping = true;
      for (const task of active.values()) if (!task.controller.signal.aborted) task.controller.abort(new AudioTaskStopped("shutdown"));
      const drained = settleWork();
      if (!(await settledWithin(drained, ioBudgetMs))) {
        await Promise.allSettled([repository.close({ timeoutSeconds: 0 }),
          ...(options.forceCloseApplicationDatabase === undefined ? [] : [options.forceCloseApplicationDatabase()])]);
        if (!(await settledWithin(drained, ioBudgetMs))) {
          requestFatal();
          throw new Error("Audio work did not drain after resource closure; process exit is required.");
        }
      }
      await repository.close({ timeoutSeconds: 0 });
    })();
    return stopPromise;
  }

  return {
    get accepting() { return !stopping && !fatal; },
    request(signal, clientIp, logger = options.logger) {
      if (stopping || fatal || typeof clientIp !== "string" || clientIp.length === 0) return Promise.reject(new AbuseControlStopped("unavailable", "configuration"));
      let resolveResponse!: (value: SignalAudioDetail) => void;
      let rejectResponse!: (error: unknown) => void;
      const response = new Promise<SignalAudioDetail>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
      const task: AudioTask = {
        controller: new AbortController(), promise: Promise.resolve(), commitStarted: false,
        ready: false, readyUncertain: false, fileCreated: false, responded: false,
        resolve(value) { if (!task.responded) { task.responded = true; resolveResponse(value); } },
        reject(error) { if (!task.responded) { task.responded = true; rejectResponse(error); } },
      };
      const taskId = randomUUID();
      active.set(taskId, task);
      task.promise = runTask(task, typeof signal === "string" ? signal : signal.id, clientIp, logger)
        .catch(() => { task.reject(unavailable()); })
        .finally(() => { active.delete(taskId); });
      return response;
    },
    stop,
  };
}
