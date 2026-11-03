import { AsyncLocalStorage } from "node:async_hooks";
import { throwIfAbuseStopped } from "./abuse-errors.js";

export type GenerationExecutionStopReason = "obsolete" | "deadline" | "shutdown" | "storage-uncertain" | "aborted";
export type GenerationDispatchKind = "chat" | "embedding" | "reranker";
export type GenerationExecutionContext = {
  attemptId: string;
  signal: AbortSignal;
  assertActive(): Promise<void>;
  beforeDispatch(meta: { kind: GenerationDispatchKind; stage: string }): Promise<void>;
};

export class GenerationExecutionStopped extends Error {
  constructor(readonly reason: GenerationExecutionStopReason) {
    super(`Generation execution stopped (${reason}).`);
    this.name = "GenerationExecutionStopped";
  }
}

const execution = new AsyncLocalStorage<GenerationExecutionContext>();

export async function runWithGenerationExecution<T>(context: GenerationExecutionContext, work: () => Promise<T>): Promise<T> {
  return execution.run(context, work);
}

export function getGenerationExecutionContext(): GenerationExecutionContext | undefined {
  return execution.getStore();
}

function stoppedBy(signal: AbortSignal): GenerationExecutionStopped {
  return signal.reason instanceof GenerationExecutionStopped ? signal.reason : new GenerationExecutionStopped("aborted");
}

export function throwIfGenerationStopped(error?: unknown): void {
  throwIfAbuseStopped(error);
  if (error instanceof GenerationExecutionStopped) throw error;
  const context = execution.getStore();
  if (context?.signal.aborted) throw stoppedBy(context.signal);
}

export async function assertGenerationActive(): Promise<void> {
  throwIfGenerationStopped();
  const context = execution.getStore();
  if (!context) return;
  try { await context.assertActive(); }
  catch (error) {
    throwIfGenerationStopped(error);
    // A failed ownership/storage check is not an ordinary provider failure.
    // Keep its data out of the control error and never dispatch on uncertainty.
    throw new GenerationExecutionStopped("storage-uncertain");
  }
  throwIfGenerationStopped();
}

export async function beforeGenerationDispatch(kind: GenerationDispatchKind, stage: string): Promise<void> {
  await assertGenerationActive();
  const context = execution.getStore();
  if (!context) return;
  try { await context.beforeDispatch({ kind, stage }); }
  catch (error) {
    throwIfGenerationStopped(error);
    throw new GenerationExecutionStopped("storage-uncertain");
  }
  throwIfGenerationStopped();
}

export function combineGenerationAbortSignal(local: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const context = execution.getStore();
  if (!context) return { signal: local, dispose: () => {} };
  const controller = new AbortController();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    local.removeEventListener("abort", abortLocal);
    context.signal.removeEventListener("abort", abortExecution);
  };
  const abortLocal = () => { controller.abort(local.reason); dispose(); };
  const abortExecution = () => { controller.abort(stoppedBy(context.signal)); dispose(); };
  if (context.signal.aborted) abortExecution();
  else if (local.aborted) abortLocal();
  else {
    local.addEventListener("abort", abortLocal, { once: true });
    context.signal.addEventListener("abort", abortExecution, { once: true });
    if (context.signal.aborted) abortExecution();
    else if (local.aborted) abortLocal();
  }
  return { signal: controller.signal, dispose };
}

export async function waitForGenerationRetry(milliseconds: number): Promise<void> {
  throwIfGenerationStopped();
  if (milliseconds <= 0) return;
  const context = execution.getStore();
  if (!context) {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const dispose = () => {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => { dispose(); reject(stoppedBy(context.signal)); };
    const timer = setTimeout(() => { dispose(); resolve(); }, milliseconds);
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) onAbort();
  });
  throwIfGenerationStopped();
}
