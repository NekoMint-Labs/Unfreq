import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertGenerationActive, beforeGenerationDispatch, combineGenerationAbortSignal,
  GenerationExecutionStopped, getGenerationExecutionContext, runWithGenerationExecution,
  throwIfGenerationStopped, waitForGenerationRetry, type GenerationExecutionContext,
} from "./generation-execution.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function context(attemptId = "synthetic-attempt") {
  const controller = new AbortController();
  const ctx: GenerationExecutionContext = {
    attemptId, signal: controller.signal,
    assertActive: vi.fn(async () => {}), beforeDispatch: vi.fn(async () => {}),
  };
  return { controller, ctx };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("generation execution scope", () => {
  it("isolates two concurrent attempts and leaves an ordinary call outside their scopes", async () => {
    const a = context("attempt-a");
    const b = context("attempt-b");
    const gate = deferred();
    const work = (ctx: GenerationExecutionContext) => runWithGenerationExecution(ctx, async () => {
      expect(getGenerationExecutionContext()).toBe(ctx);
      await gate.promise;
      await assertGenerationActive();
      return getGenerationExecutionContext()?.attemptId;
    });
    const results = Promise.allSettled([work(a.ctx), work(b.ctx)]);
    expect(getGenerationExecutionContext()).toBeUndefined();
    await assertGenerationActive();
    a.controller.abort(new GenerationExecutionStopped("deadline"));
    gate.resolve();
    expect(await results).toMatchObject([
      { status: "rejected", reason: { reason: "deadline" } },
      { status: "fulfilled", value: "attempt-b" },
    ]);
    expect(b.controller.signal.aborted).toBe(false);
    expect(getGenerationExecutionContext()).toBeUndefined();
  });

  it("preserves control errors outside a scope and never promotes an ordinary provider error", () => {
    const stopped = new GenerationExecutionStopped("obsolete");
    expect(() => throwIfGenerationStopped(stopped)).toThrow(stopped);
    expect(() => throwIfGenerationStopped(new Error("ordinary provider failure"))).not.toThrow();
  });

  it("treats an arbitrary attempt abort reason as a safe control error", async () => {
    const { controller, ctx } = context();
    controller.abort(new Error("synthetic-private-reason"));
    await expect(runWithGenerationExecution(ctx, assertGenerationActive)).rejects.toMatchObject({
      name: "GenerationExecutionStopped", reason: "aborted", message: "Generation execution stopped (aborted).",
    });
    expect(ctx.assertActive).not.toHaveBeenCalled();
  });

  it("preserves ownership rejection and converts unclassified storage/dispatch checks to control", async () => {
    const { ctx } = context();
    const obsolete = new GenerationExecutionStopped("obsolete");
    vi.mocked(ctx.assertActive).mockRejectedValueOnce(obsolete);
    await expect(runWithGenerationExecution(ctx, assertGenerationActive)).rejects.toBe(obsolete);
    vi.mocked(ctx.assertActive).mockRejectedValueOnce(new Error("database details must not escape"));
    await expect(runWithGenerationExecution(ctx, assertGenerationActive)).rejects.toMatchObject({ reason: "storage-uncertain" });
    vi.mocked(ctx.beforeDispatch).mockRejectedValueOnce(new Error("unknown dispatch write result"));
    await expect(runWithGenerationExecution(ctx, () => beforeGenerationDispatch("chat", "signal-material")))
      .rejects.toMatchObject({ reason: "storage-uncertain" });
  });

  it("rechecks an abort that arrives during an ownership check and prevents dispatch", async () => {
    const { ctx, controller } = context();
    const gate = deferred();
    vi.mocked(ctx.assertActive).mockImplementationOnce(() => gate.promise);
    const result = runWithGenerationExecution(ctx, () => beforeGenerationDispatch("embedding", "embedding"));
    const rejected = expect(result).rejects.toMatchObject({ reason: "shutdown" });
    controller.abort(new GenerationExecutionStopped("shutdown"));
    gate.resolve();
    await rejected;
    expect(ctx.beforeDispatch).not.toHaveBeenCalled();
  });
});

describe("owned cancellation resources", () => {
  it("keeps a local HTTP timeout separate and removes both source listeners", async () => {
    const { ctx, controller } = context();
    const local = new AbortController();
    const localError = new DOMException("local timeout", "AbortError");
    await runWithGenerationExecution(ctx, async () => {
      const combined = combineGenerationAbortSignal(local.signal);
      expect(getEventListeners(ctx.signal, "abort")).toHaveLength(1);
      expect(getEventListeners(local.signal, "abort")).toHaveLength(1);
      local.abort(localError);
      expect(combined.signal.reason).toBe(localError);
      expect(controller.signal.aborted).toBe(false);
      expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
      expect(getEventListeners(local.signal, "abort")).toHaveLength(0);
      combined.dispose();
    });
    expect(combineGenerationAbortSignal(local.signal).signal).toBe(local.signal);
  });

  it("forwards an execution abort, supports already-aborted sources, and disposes idempotently", async () => {
    const { ctx, controller } = context();
    const local = new AbortController();
    const stopped = new GenerationExecutionStopped("shutdown");
    await runWithGenerationExecution(ctx, async () => {
      const combined = combineGenerationAbortSignal(local.signal);
      controller.abort(stopped);
      expect(combined.signal.reason).toBe(stopped);
      expect(local.signal.aborted).toBe(false);
      combined.dispose();
      combined.dispose();
      expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
      expect(getEventListeners(local.signal, "abort")).toHaveLength(0);
      const alreadyAborted = combineGenerationAbortSignal(local.signal);
      expect(alreadyAborted.signal.reason).toBe(stopped);
      alreadyAborted.dispose();
      expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
    });
  });

  it("cancels backoff without a live timer/listener and preserves ordinary sleep", async () => {
    vi.useFakeTimers();
    const { ctx, controller } = context();
    const wait = runWithGenerationExecution(ctx, () => waitForGenerationRetry(10_000));
    const rejected = expect(wait).rejects.toMatchObject({ reason: "deadline" });
    expect(vi.getTimerCount()).toBe(1);
    controller.abort(new GenerationExecutionStopped("deadline"));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
    const ordinary = waitForGenerationRetry(50);
    await vi.advanceTimersByTimeAsync(50);
    await ordinary;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the execution listener when a retry wait completes normally", async () => {
    vi.useFakeTimers();
    const { ctx } = context();
    const wait = runWithGenerationExecution(ctx, () => waitForGenerationRetry(20));
    await vi.advanceTimersByTimeAsync(20);
    await wait;
    expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
