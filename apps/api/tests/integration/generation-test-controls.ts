import { randomUUID } from "node:crypto";
import { GenerationExecutionStopped, getGenerationExecutionContext } from "../../src/shared/generation-execution.js";
import type { GenerationFence } from "../../src/modules/signals/generation-types.js";
import type { SignalGenerationRepository } from "../../src/modules/signals/generation-repository.js";

export type CheckpointPoint = "before-dispatch" | "before-complete" | "before-next-claim";
export type CheckpointState = {
  gateId: string; point: CheckpointPoint; reached: boolean; released: boolean;
  signalId?: string; attemptId?: string; ownerId?: string;
};
export type GenerationControlState = {
  checkpoint?: CheckpointState;
  claimCallsCompleted: number;
  lastClaimSize: number;
  retries: Array<{ attemptId: string; backoffMs: number }>;
  completions: Array<{ signalId: string; attemptId: string; outcome: "APPLIED" | "OBSOLETE" }>;
};

// All data operations delegate to the real repository. These gates pause only
// before a real call; they never synthesize a claim, CAS result or output.
export function createGenerationTestControls(real: SignalGenerationRepository, caseId: string) {
  const state: GenerationControlState = { claimCallsCompleted: 0, lastClaimSize: 0, retries: [], completions: [] };
  let gate: { state: CheckpointState; enter: (fence?: GenerationFence) => Promise<void>; release: () => void } | undefined;
  let capturedCompletion: Parameters<SignalGenerationRepository["completeOwnedSignalGeneration"]>[0] | undefined;
  let completionProbed = false;
  const scanLifetime = new AbortController();

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
    async claimSignalGenerationBatch(params) {
      await enter("before-next-claim");
      const rows = await real.claimSignalGenerationBatch(params);
      state.claimCallsCompleted += 1;
      state.lastClaimSize = rows.length;
      return rows;
    },
    async markSignalGenerationDispatch(fence) {
      await enter("before-dispatch", fence);
      return real.markSignalGenerationDispatch(fence);
    },
    async completeOwnedSignalGeneration(params) {
      if (caseId === "aba") {
        if (capturedCompletion) throw new Error("ABA completion was already captured.");
        capturedCompletion = params;
      }
      await enter("before-complete", params.fence);
      const result = await real.completeOwnedSignalGeneration(params);
      state.completions.push({ signalId: params.fence.signalId, attemptId: params.fence.attemptId, outcome: result.outcome });
      return result;
    },
    async requeueUndispatchedSignalGeneration(params) {
      const result = await real.requeueUndispatchedSignalGeneration(params);
      if (result.outcome === "APPLIED") state.retries.push({ attemptId: params.fence.attemptId, backoffMs: params.backoffMs });
      return result;
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
      const result = await real.completeOwnedSignalGeneration(capturedCompletion);
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
