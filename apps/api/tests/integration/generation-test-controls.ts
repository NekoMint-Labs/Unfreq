import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { GenerationExecutionStopped, getGenerationExecutionContext } from "../../src/shared/generation-execution.js";
import type { GenerationFence } from "../../src/modules/signals/generation-types.js";
import type { SignalGenerationRepository } from "../../src/modules/signals/generation-repository.js";
import type { RunningGenerationPhase } from "../../src/modules/signals/generation-types.js";

export type CheckpointPoint = "before-dispatch" | "before-complete" | "before-next-claim";
export type CheckpointState = {
  gateId: string; point: CheckpointPoint; reached: boolean; released: boolean;
  signalId?: string; attemptId?: string; ownerId?: string;
};
export type GenerationRepositoryTimingOutcome =
  "PENDING" | "RETURNED" | "THREW" | "APPLIED" | "OBSOLETE" |
  "ACTIVE" | "INACTIVE" | "EMPTY" | "CLAIMED" | "COMPLETED" | "FAILED";
export type GenerationRepositoryTiming = {
  seq: number;
  callId: number;
  method: keyof SignalGenerationRepository;
  event: "entry" | "exit";
  at: number;
  elapsedMs: number;
  outcome: GenerationRepositoryTimingOutcome;
  signalId?: string;
  attemptId?: string;
  fromPhase?: RunningGenerationPhase;
  toPhase?: RunningGenerationPhase;
};
export type GenerationControlState = {
  checkpoint?: CheckpointState;
  claimCallsCompleted: number;
  lastClaimSize: number;
  retries: Array<{ attemptId: string; backoffMs: number }>;
  completions: Array<{ signalId: string; attemptId: string; outcome: "APPLIED" | "OBSOLETE" }>;
  timings: GenerationRepositoryTiming[];
  timingsDropped: number;
};

// All data operations delegate to the real repository. These gates pause only
// before a real call; they never synthesize a claim, CAS result or output.
export function createGenerationTestControls(real: SignalGenerationRepository, caseId: string) {
  const state: GenerationControlState = {
    claimCallsCompleted: 0, lastClaimSize: 0, retries: [], completions: [], timings: [], timingsDropped: 0,
  };
  let timingSequence = 0;
  let timingCallSequence = 0;
  let gate: { state: CheckpointState; enter: (fence?: GenerationFence) => Promise<void>; release: () => void } | undefined;
  let capturedCompletion: Parameters<SignalGenerationRepository["completeOwnedSignalGeneration"]>[0] | undefined;
  let completionProbed = false;
  const scanLifetime = new AbortController();

  function recordTiming(event: Omit<GenerationRepositoryTiming, "seq">) {
    state.timings.push({ seq: ++timingSequence, ...event });
    if (state.timings.length > 256) {
      state.timings.splice(0, state.timings.length - 256);
      state.timingsDropped += 1;
    }
  }

  // Observe only the real call, after any deliberate checkpoint wait. Return
  // its original Promise and preserve synchronous throws and rejection values.
  function timed<T>(
    method: keyof SignalGenerationRepository,
    detail: Pick<GenerationRepositoryTiming, "signalId" | "attemptId" | "fromPhase" | "toPhase">,
    run: () => Promise<T>,
    outcome: (value: T) => GenerationRepositoryTimingOutcome = () => "RETURNED",
  ): Promise<T> {
    const callId = ++timingCallSequence;
    const startedAt = performance.now();
    recordTiming({ ...detail, callId, method, event: "entry", at: Date.now(), elapsedMs: 0, outcome: "PENDING" });
    const finish = (result: GenerationRepositoryTimingOutcome) => recordTiming({
      ...detail, callId, method, event: "exit", at: Date.now(),
      elapsedMs: Math.max(0, performance.now() - startedAt), outcome: result,
    });
    try {
      const work = run();
      void work.then((value) => { finish(outcome(value)); }, () => { finish("THREW"); });
      return work;
    } catch (error) {
      finish("THREW");
      throw error;
    }
  }

  const fenceDetail = (fence: Pick<GenerationFence, "signalId" | "attemptId">) => ({
    signalId: fence.signalId, attemptId: fence.attemptId,
  });

  function arm(point: CheckpointPoint) {
    const allowed = (point === "before-next-claim" && caseId === "capacity") ||
      (point === "before-dispatch" && ["predispatch", "closeearly"].includes(caseId)) ||
      (point === "before-complete" && ["prewrite", "aba"].includes(caseId));
    if (!allowed || (gate && !gate.state.released)) throw new Error("Invalid checkpoint arm.");
    const current: CheckpointState = { gateId: randomUUID(), point, reached: false, released: false };
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    gate = {
      state: current,
      release() { current.released = true; release(); },
      async enter(fence) {
        current.reached = true;
        if (fence) Object.assign(current, { signalId: fence.signalId, attemptId: fence.attemptId, ownerId: fence.ownerId });
        const signal = point === "before-next-claim" ? scanLifetime.signal : getGenerationExecutionContext()?.signal;
        if (!signal) throw new Error("Execution checkpoint lost its real context.");
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(signal.reason instanceof GenerationExecutionStopped ? signal.reason : new GenerationExecutionStopped("shutdown"));
          };
          signal.addEventListener("abort", abort, { once: true });
          void released.then(() => { signal.removeEventListener("abort", abort); resolve(); });
          if (signal.aborted) abort();
        });
      },
    };
    state.checkpoint = current;
    return { gateId: current.gateId };
  }

  async function enter(point: CheckpointPoint, fence?: GenerationFence) {
    const selected = gate;
    if (selected?.state.point === point && !selected.state.released && !selected.state.reached) await selected.enter(fence);
  }

  const repository: SignalGenerationRepository = {
    ...real,
    createManagedPendingSignal(input) {
      return timed("createManagedPendingSignal", {}, () => real.createManagedPendingSignal(input));
    },
    async claimSignalGenerationBatch(params) {
      await enter("before-next-claim");
      const rows = await timed("claimSignalGenerationBatch", {}, () => real.claimSignalGenerationBatch(params),
        (value) => value.length === 0 ? "EMPTY" : "CLAIMED");
      state.claimCallsCompleted += 1;
      state.lastClaimSize = rows.length;
      return rows;
    },
    isSignalGenerationAttemptActive(fence) {
      return timed("isSignalGenerationAttemptActive", fenceDetail(fence),
        () => real.isSignalGenerationAttemptActive(fence), (value) => value ? "ACTIVE" : "INACTIVE");
    },
    readOwnedSignalGenerationInput(fence) {
      return timed("readOwnedSignalGenerationInput", fenceDetail(fence),
        () => real.readOwnedSignalGenerationInput(fence), (value) => value.outcome);
    },
    advanceSignalGenerationPhase(params) {
      return timed("advanceSignalGenerationPhase", {
        ...fenceDetail(params.fence), fromPhase: params.from, toPhase: params.to,
      }, () => real.advanceSignalGenerationPhase(params), (value) => value.outcome);
    },
    async markSignalGenerationDispatch(fence) {
      await enter("before-dispatch", fence);
      return timed("markSignalGenerationDispatch", fenceDetail(fence),
        () => real.markSignalGenerationDispatch(fence), (value) => value.outcome);
    },
    renewSignalGenerationLease(params) {
      return timed("renewSignalGenerationLease", fenceDetail(params.fence),
        () => real.renewSignalGenerationLease(params), (value) => value.outcome);
    },
    async completeOwnedSignalGeneration(params) {
      if (caseId === "aba") {
        if (capturedCompletion) throw new Error("ABA completion was already captured.");
        capturedCompletion = params;
      }
      await enter("before-complete", params.fence);
      const result = await timed("completeOwnedSignalGeneration", fenceDetail(params.fence),
        () => real.completeOwnedSignalGeneration(params), (value) => value.outcome);
      state.completions.push({ signalId: params.fence.signalId, attemptId: params.fence.attemptId, outcome: result.outcome });
      return result;
    },
    failOwnedSignalGeneration(params) {
      return timed("failOwnedSignalGeneration", fenceDetail(params.fence),
        () => real.failOwnedSignalGeneration(params), (value) => value.outcome);
    },
    async requeueUndispatchedSignalGeneration(params) {
      const result = await timed("requeueUndispatchedSignalGeneration", fenceDetail(params.fence),
        () => real.requeueUndispatchedSignalGeneration(params), (value) => value.outcome);
      if (result.outcome === "APPLIED") state.retries.push({ attemptId: params.fence.attemptId, backoffMs: params.backoffMs });
      return result;
    },
    recoverExpiredSignalGenerations(params) {
      return timed("recoverExpiredSignalGenerations", {}, () => real.recoverExpiredSignalGenerations(params));
    },
    findGenerationAttemptOutcome(params) {
      return timed("findGenerationAttemptOutcome", fenceDetail(params),
        () => real.findGenerationAttemptOutcome(params), (value) => value);
    },
    closeSignalGenerationRepository(params) {
      return timed("closeSignalGenerationRepository", {}, () => real.closeSignalGenerationRepository(params));
    },
  };
  return {
    repository, state, arm,
    release(gateId: string) {
      if (!gate || gate.state.gateId !== gateId || gate.state.released) throw new Error("Invalid checkpoint release.");
      gate.release();
      return { released: true };
    },
    async probeCompletion(signalId: string) {
      if (caseId !== "aba" || completionProbed || !capturedCompletion || capturedCompletion.fence.signalId !== signalId ||
          gate?.state.point !== "before-complete" || !gate.state.reached) throw new Error("ABA probe has no owned captured completion.");
      const result = await timed("completeOwnedSignalGeneration", fenceDetail(capturedCompletion.fence),
        () => real.completeOwnedSignalGeneration(capturedCompletion!), (value) => value.outcome);
      completionProbed = true;
      state.completions.push({ signalId, attemptId: capturedCompletion.fence.attemptId, outcome: result.outcome });
      return { accepted: result.outcome === "APPLIED", outcome: result.outcome };
    },
    stopScanGate() {
      scanLifetime.abort(new GenerationExecutionStopped("shutdown"));
      // No ALS context exists in scan. Reject its wait before real.stop()
      // synchronously marks stopping; never leave a pending scan in teardown.
    },
  };
}
