import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beforeGenerationDispatch, getGenerationExecutionContext,
} from "../../shared/generation-execution.js";
import { fixtureFingerprint, fixtureSeed } from "../../../tests/integration/fixtures.js";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { createSignalGenerationWorker, type GenerationWorkerConfig, type GenerationWorkerOptions, type SignalGenerationWorker } from "./generation-worker.js";
import type { SignalGenerationRepository } from "./generation-repository.js";
import type { GenerationClaim, GenerationOutput, OwnedGenerationInput } from "./generation-types.js";
import type { SignalRecord } from "./types.js";

vi.mock("./generation-repository.js", () => ({
  configureSignalGenerationRepository: () => { throw new Error("Unit workers must use their injected repository."); },
  GenerationInputUnavailableError: class GenerationInputUnavailableError extends Error {},
}));
vi.mock("./service-creation.js", () => ({
  generateOwnedSignalOutput: () => { throw new Error("Unit workers must use their injected executor."); },
}));

type Execute = NonNullable<GenerationWorkerOptions["execute"]>;
const workers: SignalGenerationWorker[] = [];
const releases: Array<() => void> = [];
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const ownerId = uuid(9000);
const baseConfig: GenerationWorkerConfig = {
  enabled: true, concurrency: 2, scanIntervalMs: 10_000,
  leaseMs: 6_000, heartbeatMs: 1_000, attemptTimeoutMs: 8_000,
  maxAttempts: 3, retryBaseMs: 10, retryMaxMs: 100, shutdownGraceMs: 50,
  dbStatementTimeoutMs: 20, dbLockTimeoutMs: 5,
};
const output: GenerationOutput = {
  expandedText: "Synthetic completed worker result.", fingerprint: fixtureFingerprint,
  galaxyPosition: { x: 0, y: 0, z: 0 }, status: "DRAFT",
  program: { bridgeNarration: "synthetic", closingQuestion: "synthetic?", hostIntro: "synthetic", leftSignalSummary: "synthetic", programTitle: "synthetic", shareQuote: "synthetic" },
};
const applied = <T>(value: T) => ({ outcome: "APPLIED" as const, value });
const obsolete = { outcome: "OBSOLETE" as const };

function controlled<T>(cleanupValue: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  releases.push(() => resolve(cleanupValue));
  return { promise, resolve };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
// Advance the controller's documented I/O observation budget explicitly.
// vi.waitFor's wall-clock polling can under-advance a fake clock when this
// file shares CPU with cold Fastify tests. These steps keep every real worker
// budget and assertion unchanged; they only drive its existing timers.
const ioDrainBudgetMs = (config: GenerationWorkerConfig) => config.dbStatementTimeoutMs + config.dbLockTimeoutMs + 1000;

function claim(index: number, remainingMs = baseConfig.attemptTimeoutMs): GenerationClaim {
  return {
    signalId: uuid(index), attemptId: uuid(index + 1000), ownerId, attemptCount: 1,
    leaseUntil: new Date(Date.now() + Math.min(baseConfig.leaseMs, remainingMs)),
    deadlineAt: new Date(Date.now() + remainingMs), remainingMs,
  };
}
function input(fence: { signalId: string }): OwnedGenerationInput {
  return {
    signalId: fence.signalId, body: { seedText: fixtureSeed },
    frequency: { id: uuid(8000), freqCode: "FM 00.01", createdAt: new Date().toISOString(), isGuest: false, role: "USER", status: "ACTIVE" },
  };
}
function completedRecord(id: string): SignalRecord {
  return {
    id, authorId: uuid(8000), authorFreqCode: "FM 00.01", frequencyId: uuid(8000),
    audioError: null, audioStatus: "NOT_REQUESTED", audioStorageKey: null, audioStorageKeyLeft: null, audioStorageKeyRight: null,
    audioUrl: null, audioUrlLeft: null, audioUrlRight: null,
    createdAt: new Date(), updatedAt: new Date(), echoCount: 0, resonanceCount: 0, resonanceKeywords: null,
    embedding: null, embeddingDimensions: null, embeddingModel: null, embeddingProvider: null, embeddingVersion: null,
    expandedText: output.expandedText, fingerprintJson: fixtureFingerprint, followUpQuestion: null,
    galaxyPosition: output.galaxyPosition, generationError: null, generationStatus: "COMPLETED", guestKey: null,
    coreNeed: null, emotionTone: null, innerConflict: null, matchSignalId: null, parentSignalId: null,
    primaryBand: "self_mirror", programJson: output.program, qualityReason: null, qualityScore: null,
    rawInput: fixtureSeed, seedText: fixtureSeed, source: "human", status: "DRAFT", subFeeling: "self_acceptance", isKept: false,
  };
}

function setup(overrides: Partial<GenerationWorkerConfig> = {}) {
  const queued: GenerationClaim[] = [];
  // The adapter supplies outcomes and controlled Promises only. It does not
  // reproduce SQL predicates, leases, locks, retry selection or CAS semantics.
  const repository = {
    createManagedPendingSignal: vi.fn<SignalGenerationRepository["createManagedPendingSignal"]>().mockRejectedValue(new Error("Not used by this controller test.")),
    claimSignalGenerationBatch: vi.fn<SignalGenerationRepository["claimSignalGenerationBatch"]>().mockImplementation(async (params) => queued.splice(0, params.localAvailable)),
    isSignalGenerationAttemptActive: vi.fn<SignalGenerationRepository["isSignalGenerationAttemptActive"]>().mockResolvedValue(true),
    readOwnedSignalGenerationInput: vi.fn<SignalGenerationRepository["readOwnedSignalGenerationInput"]>().mockImplementation(async (fence) => applied(input(fence))),
    advanceSignalGenerationPhase: vi.fn<SignalGenerationRepository["advanceSignalGenerationPhase"]>().mockResolvedValue(applied(undefined)),
    markSignalGenerationDispatch: vi.fn<SignalGenerationRepository["markSignalGenerationDispatch"]>().mockResolvedValue(applied(undefined)),
    renewSignalGenerationLease: vi.fn<SignalGenerationRepository["renewSignalGenerationLease"]>().mockResolvedValue(applied({ leaseUntil: new Date(Date.now() + baseConfig.leaseMs) })),
    completeOwnedSignalGeneration: vi.fn<SignalGenerationRepository["completeOwnedSignalGeneration"]>().mockImplementation(async ({ fence }) => applied(completedRecord(fence.signalId))),
    failOwnedSignalGeneration: vi.fn<SignalGenerationRepository["failOwnedSignalGeneration"]>().mockResolvedValue(applied(undefined)),
    requeueUndispatchedSignalGeneration: vi.fn<SignalGenerationRepository["requeueUndispatchedSignalGeneration"]>().mockResolvedValue(applied(undefined)),
    recoverExpiredSignalGenerations: vi.fn<SignalGenerationRepository["recoverExpiredSignalGenerations"]>().mockResolvedValue({ requeuedIds: [], failedIds: [] }),
    findGenerationAttemptOutcome: vi.fn<SignalGenerationRepository["findGenerationAttemptOutcome"]>().mockResolvedValue("ACTIVE"),
    closeSignalGenerationRepository: vi.fn<SignalGenerationRepository["closeSignalGenerationRepository"]>().mockResolvedValue(undefined),
  } satisfies SignalGenerationRepository;
  const execute = vi.fn<Execute>().mockImplementation(async (params) => {
    await params.onGenerationStatusChange("MATCHING");
    await params.onGenerationStatusChange("WRITING");
    return output;
  });
  const forceCloseApplicationDatabase = vi.fn(async () => {});
  const onFatal = vi.fn<NonNullable<GenerationWorkerOptions["onFatal"]>>();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config = { ...baseConfig, ...overrides };
  const worker = createSignalGenerationWorker({ config, repository, execute, ownerId, forceCloseApplicationDatabase, onFatal, logger });
  workers.push(worker);
  return { worker, config, repository, execute, queued, forceCloseApplicationDatabase, onFatal, logger };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Controller unit tests must not send HTTP."); }));
});
afterEach(async () => {
  // Even an assertion failure releases every synthetic I/O gate. stop() is
  // called before advancing the clock, so cleanup cannot start fresh claims.
  for (const release of releases.splice(0)) release();
  const stopped = workers.splice(0).map((worker) => worker.stop().catch(() => {}));
  await vi.advanceTimersByTimeAsync(5_000);
  await Promise.all(stopped);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generation worker controller", () => {
  it("serializes repeated wake calls while one scan is waiting on a repository claim", async () => {
    const h = setup();
    const heldClaim = controlled<GenerationClaim[]>([]);
    let claiming = 0;
    let peak = 0;
    h.repository.claimSignalGenerationBatch.mockImplementationOnce(async () => {
      claiming += 1;
      peak = Math.max(peak, claiming);
      const result = await heldClaim.promise;
      claiming -= 1;
      return result;
    });
    h.worker.wake();
    expect(h.repository.claimSignalGenerationBatch).not.toHaveBeenCalled();
    h.worker.start();
    h.worker.start();
    await flush();
    for (let index = 0; index < 10; index += 1) h.worker.wake();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.repository.claimSignalGenerationBatch).toHaveBeenCalledTimes(1);
    expect(h.repository.recoverExpiredSignalGenerations).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
    heldClaim.resolve([]);
    await flush();
    expect(h.repository.claimSignalGenerationBatch).toHaveBeenCalledTimes(2);
    expect(h.worker.accepting).toBe(true);
  });

  it("uses only available local slots and starts the third job after a real execution settles", async () => {
    const h = setup();
    const claims = [claim(1), claim(2), claim(3)];
    h.queued.push(...claims);
    const gates = new Map(claims.map((item) => [item.signalId, controlled(output)]));
    let executing = 0;
    let peak = 0;
    h.execute.mockImplementation(async (params) => {
      executing += 1;
      peak = Math.max(peak, executing);
      try {
        await gates.get(params.signalId)!.promise;
        await params.onGenerationStatusChange("MATCHING");
        await params.onGenerationStatusChange("WRITING");
        return output;
      } finally { executing -= 1; }
    });
    h.worker.start();
    await flush();
    expect(h.worker.activeCount).toBe(2);
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.repository.claimSignalGenerationBatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ ownerId, globalCapacity: 2, localAvailable: 2 }));
    h.worker.wake();
    await flush();
    expect(h.repository.claimSignalGenerationBatch).toHaveBeenCalledTimes(1);
    gates.get(claims[0].signalId)!.resolve(output);
    await flush();
    expect(h.execute).toHaveBeenCalledTimes(3);
    expect(h.worker.activeCount).toBe(2);
    expect(h.repository.claimSignalGenerationBatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ localAvailable: 1 }));
    expect(peak).toBe(2);
    gates.get(claims[1].signalId)!.resolve(output);
    gates.get(claims[2].signalId)!.resolve(output);
    await flush();
    expect(h.worker.activeCount).toBe(0);
    expect(h.repository.completeOwnedSignalGeneration).toHaveBeenCalledTimes(3);
  });

  it.each(["input", "phase", "completion"] as const)("does not write FAILED or requeue an obsolete %s result", async (boundary) => {
    const h = setup();
    h.queued.push(claim(10));
    if (boundary === "input") h.repository.readOwnedSignalGenerationInput.mockResolvedValueOnce(obsolete);
    if (boundary === "phase") h.repository.advanceSignalGenerationPhase.mockResolvedValueOnce(obsolete);
    if (boundary === "completion") h.repository.completeOwnedSignalGeneration.mockResolvedValueOnce(obsolete);
    // ACTIVE prevents the terminal-outcome shortcut from hiding whether the
    // controller specifically recognizes its obsolete control error.
    h.worker.start();
    await flush();
    expect(h.worker.activeCount).toBe(0);
    expect(h.repository.findGenerationAttemptOutcome).toHaveBeenCalledTimes(1);
    expect(h.repository.failOwnedSignalGeneration).not.toHaveBeenCalled();
    expect(h.repository.requeueUndispatchedSignalGeneration).not.toHaveBeenCalled();
    if (boundary === "input") expect(h.execute).not.toHaveBeenCalled();
  });

  it.each(["obsolete", "uncertain"] as const)("blocks external dispatch after a %s dispatch fence and does not blindly execute again", async (outcome) => {
    const h = setup();
    h.queued.push(claim(20));
    const externalDispatch = vi.fn();
    h.execute.mockImplementation(async () => {
      await beforeGenerationDispatch("chat", "synthetic-material");
      externalDispatch();
      return output;
    });
    if (outcome === "obsolete") h.repository.markSignalGenerationDispatch.mockResolvedValueOnce(obsolete);
    else h.repository.markSignalGenerationDispatch.mockRejectedValueOnce(new Error("synthetic unknown write acknowledgement"));
    // An uncertain marker may have committed. Only the real repository can
    // decide its conditional requeue; supply OBSOLETE rather than reproducing
    // that SQL here, and ensure the controller respects the refusal.
    h.repository.requeueUndispatchedSignalGeneration.mockResolvedValue(obsolete);
    h.worker.start();
    await flush();
    h.worker.wake();
    await flush();
    expect(externalDispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.repository.failOwnedSignalGeneration).not.toHaveBeenCalled();
    if (outcome === "obsolete") expect(h.repository.requeueUndispatchedSignalGeneration).not.toHaveBeenCalled();
    else expect(h.repository.requeueUndispatchedSignalGeneration).toHaveBeenCalledTimes(1);
  });

  it("uses the database's remaining deadline but retains the local slot until the real execution ends", async () => {
    const h = setup({ concurrency: 1 });
    const first = claim(30, 30);
    const second = claim(31);
    h.queued.push(first, second);
    const held = controlled(output);
    const secondHeld = controlled(output);
    const events: string[] = [];
    let firstSignal: AbortSignal | undefined;
    h.execute.mockImplementation(async (params) => {
      const context = getGenerationExecutionContext();
      if (!context) throw new Error("The worker did not enter its execution context.");
      if (params.signalId === first.signalId) {
        firstSignal = context.signal;
        await held.promise;
        events.push("first-work-ended");
      } else {
        events.push("second-started");
        await secondHeld.promise;
      }
      return output;
    });
    h.worker.start();
    await flush();
    await vi.advanceTimersByTimeAsync(31);
    expect(firstSignal?.aborted).toBe(true);
    expect(firstSignal?.reason).toMatchObject({ reason: "deadline" });
    h.worker.wake();
    await flush();
    expect(h.worker.activeCount).toBe(1);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.repository.failOwnedSignalGeneration).not.toHaveBeenCalled();
    held.resolve(output);
    await flush();
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["first-work-ended", "second-started"]);
    expect(h.worker.activeCount).toBe(1);
    secondHeld.resolve(output);
    await flush();
  });

  it("makes stop idempotent, stops accepting immediately and waits after shutdown abort until execution settles", async () => {
    const h = setup({ concurrency: 1 });
    h.queued.push(claim(40));
    const held = controlled(output);
    let signal: AbortSignal | undefined;
    h.execute.mockImplementation(async () => { signal = getGenerationExecutionContext()!.signal; return held.promise; });
    h.worker.start();
    await flush();
    const stopping = h.worker.stop();
    expect(h.worker.stop()).toBe(stopping);
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    expect(h.worker.accepting).toBe(false);
    h.worker.wake();
    h.worker.start();
    await vi.advanceTimersByTimeAsync(h.config.shutdownGraceMs + 1);
    expect(signal?.reason).toMatchObject({ reason: "shutdown" });
    expect(stopped).toBe(false);
    expect(h.worker.activeCount).toBe(1);
    expect(h.forceCloseApplicationDatabase).not.toHaveBeenCalled();
    held.resolve(output);
    await flush();
    await stopping;
    expect(stopped).toBe(true);
    expect(h.worker.activeCount).toBe(0);
    expect(h.forceCloseApplicationDatabase).not.toHaveBeenCalled();
    expect(h.repository.closeSignalGenerationRepository).toHaveBeenCalledTimes(1);
  });

  it("closes only its injected pools after the drain budget and still waits for real pending work to settle", async () => {
    const h = setup({ concurrency: 1 });
    h.queued.push(claim(50));
    const held = controlled(output);
    h.execute.mockImplementation(async () => held.promise);
    h.worker.start();
    await flush();
    const stopping = h.worker.stop();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(h.config.shutdownGraceMs + 1);
    expect(h.forceCloseApplicationDatabase).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ioDrainBudgetMs(h.config) + 1);
    expect(h.forceCloseApplicationDatabase).toHaveBeenCalledTimes(1);
    expect(h.repository.closeSignalGenerationRepository).toHaveBeenCalledWith({ timeoutSeconds: 0 });
    expect(stopped).toBe(false);
    expect(h.worker.activeCount).toBe(1);
    held.resolve(output);
    await flush();
    await stopping;
    expect(stopped).toBe(true);
    expect(h.worker.activeCount).toBe(0);
  });

  it("rejects stop instead of reporting success when execution still cannot settle after owned pool closure", async () => {
    const h = setup({ concurrency: 1 });
    h.queued.push(claim(60));
    const held = controlled(output);
    h.execute.mockImplementation(async () => held.promise);
    h.worker.start();
    await flush();
    const stopping = h.worker.stop();
    const rejected = expect(stopping).rejects.toThrow("process exit is required");
    await vi.advanceTimersByTimeAsync(3_000);
    await rejected;
    expect(h.forceCloseApplicationDatabase).toHaveBeenCalledTimes(1);
    expect(h.worker.activeCount).toBe(1);
    expect(h.worker.accepting).toBe(false);
    // The test must settle the deliberately uncooperative fake even after
    // asserting the rejected shutdown; a watchdog timeout is not cleanup.
    held.resolve(output);
    await flush();
    expect(h.worker.activeCount).toBe(0);
  });

  it.each(["limited", "unavailable"] as const)("settles a provider protection %s without replaying the generation", async (reason) => {
    const h = setup();
    h.queued.push(claim(400));
    h.execute.mockImplementationOnce(async () => {
      await beforeGenerationDispatch("chat", "synthetic-first-dispatch");
      throw new AbuseControlStopped(reason, "chatCallsSite", 1000);
    });
    h.worker.start();
    await flush();
    expect(h.repository.failOwnedSignalGeneration).toHaveBeenCalledWith(expect.objectContaining({
      code: reason === "limited" ? "GENERATION_RATE_LIMITED" : "GENERATION_PROTECTION_UNAVAILABLE",
    }));
    expect(h.repository.requeueUndispatchedSignalGeneration).not.toHaveBeenCalled();
    expect(h.repository.completeOwnedSignalGeneration).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.worker.activeCount).toBe(0);
  });

  it("pauses a transient scan failure and retries on the next interval without requesting fatal recovery", async () => {
    const h = setup();
    h.repository.recoverExpiredSignalGenerations.mockRejectedValueOnce(new Error("synthetic transient PostgreSQL failure"));
    h.worker.start();
    await flush();
    expect(h.worker.accepting).toBe(true);
    expect(h.repository.claimSignalGenerationBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(h.config.scanIntervalMs);
    expect(h.repository.recoverExpiredSignalGenerations).toHaveBeenCalledTimes(2);
    expect(h.repository.claimSignalGenerationBatch).toHaveBeenCalledTimes(1);
    expect(h.onFatal).not.toHaveBeenCalled();
  });

  it("requests fatal recovery once for hung scan I/O and waits for it to settle after closing the owned pool", async () => {
    const h = setup();
    const recovery = controlled({ requeuedIds: [] as string[], failedIds: [] as string[] });
    h.repository.recoverExpiredSignalGenerations.mockImplementationOnce(() => recovery.promise);
    h.repository.closeSignalGenerationRepository.mockImplementationOnce(async () => { recovery.resolve({ requeuedIds: [], failedIds: [] }); });
    h.worker.start();
    await flush();
    await vi.advanceTimersByTimeAsync(ioDrainBudgetMs(h.config) + 1);
    expect(h.onFatal).toHaveBeenCalledTimes(1);
    expect(h.worker.accepting).toBe(false);
    h.worker.wake();
    await flush();
    expect(h.repository.recoverExpiredSignalGenerations).toHaveBeenCalledTimes(1);
    const stopping = h.worker.stop();
    // Fatal recovery skips the normal grace, but stop still waits for its
    // actual zero-delay timer before starting the independent I/O budget.
    await flush();
    await vi.advanceTimersByTimeAsync(ioDrainBudgetMs(h.config) + 1);
    expect(h.repository.closeSignalGenerationRepository).toHaveBeenCalled();
    await flush();
    await stopping;
    expect(h.repository.claimSignalGenerationBatch).not.toHaveBeenCalled();
    expect(h.onFatal).toHaveBeenCalledTimes(1);
    expect(h.worker.activeCount).toBe(0);
  });
});
