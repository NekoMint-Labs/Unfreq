import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GenerationExecutionStopped, getGenerationExecutionContext, runWithGenerationExecution,
  type GenerationExecutionContext,
} from "../../shared/generation-execution.js";
import { callChatProvider } from "./provider-transport.js";
import { generateEmbedding } from "./embedding.js";
import { rerankCandidates } from "./reranker.js";
import { classifyContentWithFallback } from "./service.js";

const state = vi.hoisted(() => ({
  chat: [1, 2].map((index) => ({ apiKey: "synthetic-unit-key", baseUrl: `http://127.0.0.1:9/chat-${index}`, profile: "default", model: "synthetic-chat", provider: "synthetic" })),
  embedding: [1, 2].map((index) => ({ apiKey: "synthetic-unit-key", baseUrl: `http://127.0.0.1:9/embed-${index}`, dimensions: 3, model: "synthetic-embedding", provider: "synthetic", version: "unit-v1" })),
  reranker: [1, 2].map((index) => ({ apiKey: "synthetic-unit-key", baseUrl: `http://127.0.0.1:9/rank-${index}`, model: "synthetic-reranker", provider: "synthetic" })),
  auditConfig: vi.fn(), review: vi.fn(),
}));
vi.mock("./provider-config.js", () => ({
  resolveChatProviderConfigs: async () => state.chat,
  resolveChatProviderConfig: () => state.auditConfig(),
  resolveEmbeddingProviderConfigs: async () => state.embedding,
  resolveEmbeddingProviderConfig: async () => state.embedding[0],
  resolveRerankerProviderConfigs: async () => state.reranker,
  resolveRerankerProviderConfig: async () => state.reranker[0],
}));
vi.mock("./repository.js", () => ({ createAiReviewRecord: (...args: unknown[]) => state.review(...args) }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function execution(attemptId = "synthetic-unit-attempt") {
  const controller = new AbortController();
  const ctx: GenerationExecutionContext = {
    attemptId, signal: controller.signal,
    assertActive: vi.fn(async () => {}), beforeDispatch: vi.fn(async () => {}),
  };
  return { ctx, controller };
}
function chatResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ channel: "MIDNIGHT", confidence: 0.9, reason: "synthetic classification" }) } }] }), { status: 200 });
}
function heldResponse(init: RequestInit | undefined, started: ReturnType<typeof deferred>) {
  const signal = init?.signal;
  if (!signal) throw new Error("The real adapter did not supply its signal.");
  let release!: () => void;
  const response = new Promise<Response>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    release = () => { signal.removeEventListener("abort", abort); resolve(chatResponse()); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    started.resolve();
  });
  return { response, release: () => release() };
}
const rerankInput = { queryText: "synthetic query", candidates: [{ id: "synthetic-candidate", distance: 0.2, expandedText: "synthetic candidate" }] };

beforeEach(() => {
  state.auditConfig.mockReset().mockResolvedValue(state.chat[0]);
  state.review.mockReset().mockResolvedValue({ id: "synthetic-review" });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unconfigured unit HTTP request."); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("generation cancellation across real provider adapters", () => {
  it.each(["chat", "embedding", "reranker"] as const)("aborts one held %s request without retrying or selecting another provider", async (kind) => {
    vi.useFakeTimers();
    const { ctx, controller } = execution();
    const started = deferred();
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => heldResponse(init, started).response);
    vi.stubGlobal("fetch", fetchMock);
    const work = runWithGenerationExecution(ctx, async () => {
      if (kind === "chat") return callChatProvider("classify", "synthetic input");
      if (kind === "embedding") return generateEmbedding("synthetic input");
      return rerankCandidates(rerankInput);
    });
    const outcome = work.then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
    await started.promise;
    controller.abort(new GenerationExecutionStopped("deadline"));
    expect(await outcome).toMatchObject({ error: { name: "GenerationExecutionStopped", reason: "deadline" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ctx.beforeDispatch).toHaveBeenCalledTimes(1);
    expect(ctx.beforeDispatch).toHaveBeenCalledWith(expect.objectContaining({ kind }));
    expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch or write a fallback audit when the dispatch fence rejects ownership", async () => {
    const { ctx } = execution();
    const stopped = new GenerationExecutionStopped("obsolete");
    vi.mocked(ctx.beforeDispatch).mockRejectedValueOnce(stopped);
    await expect(runWithGenerationExecution(ctx, () => classifyContentWithFallback({ content: "synthetic input" }))).rejects.toBe(stopped);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.review).not.toHaveBeenCalled();
  });

  it.each(["chat", "embedding", "reranker"] as const)("retains %s fallback/retry after only this HTTP call times out", async (kind) => {
    vi.useFakeTimers();
    const { ctx, controller } = execution();
    const started = deferred();
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => heldResponse(init, started).response)
      .mockImplementationOnce((_input: unknown, init?: RequestInit) => heldResponse(init, started).response)
      .mockImplementationOnce(async () => {
        if (kind === "chat") return chatResponse();
        if (kind === "embedding") return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 });
        return new Response(JSON.stringify({ results: [{ id: "synthetic-candidate", reason: "synthetic", score: 0.8 }] }), { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);
    const work = runWithGenerationExecution(ctx, async () => {
      if (kind === "chat") return callChatProvider("classify", "synthetic input");
      if (kind === "embedding") return generateEmbedding("synthetic input", { retryDelayMs: 0 });
      return rerankCandidates(rerankInput);
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(kind === "chat" ? 10_000 : 5_000);
    const result = await work;
    if (kind === "chat") expect(result).toMatchObject({ channel: "MIDNIGHT" });
    else if (kind === "embedding") expect(result).toMatchObject({ embedding: [0.1, 0.2, 0.3] });
    else expect(result).toMatchObject({ results: [{ id: "synthetic-candidate" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctx.beforeDispatch).toHaveBeenCalledTimes(2);
    expect(controller.signal.aborted).toBe(false);
    expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the completed HTTP resources before cancellable embedding backoff and never retries after abort", async () => {
    vi.useFakeTimers();
    const { ctx, controller } = execution();
    const retrying = deferred();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const work = runWithGenerationExecution(ctx, () => generateEmbedding("synthetic input", {
      config: state.embedding[0], retryDelayMs: 10_000,
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(() => retrying.resolve()) },
    }));
    const outcome = work.then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
    await retrying.promise;
    // Only the backoff timer/listener remains: the failed HTTP timer and
    // signal bridge were disposed before waiting.
    expect(vi.getTimerCount()).toBe(1);
    expect(getEventListeners(ctx.signal, "abort")).toHaveLength(1);
    controller.abort(new GenerationExecutionStopped("shutdown"));
    expect(await outcome).toMatchObject({ error: { reason: "shutdown" } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getEventListeners(ctx.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps concurrent A/B adapter calls isolated from each other and from an ordinary call", async () => {
    const a = execution("scope-a");
    const b = execution("scope-b");
    const aStarted = deferred();
    const bStarted = deferred();
    let releaseB!: () => void;
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      const content = body.messages.find((message) => message.role === "user")?.content;
      if (content === "scope-a") return heldResponse(init, aStarted).response;
      if (content === "scope-b") {
        const held = heldResponse(init, bStarted);
        releaseB = held.release;
        return held.response;
      }
      return Promise.resolve(chatResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const failedA = runWithGenerationExecution(a.ctx, () => classifyContentWithFallback({ content: "scope-a" }))
      .then(() => ({ succeeded: true }), (error: unknown) => ({ error }));
    const resultB = runWithGenerationExecution(b.ctx, () => classifyContentWithFallback({ content: "scope-b" }));
    const ordinary = classifyContentWithFallback({ content: "ordinary-synthetic" });
    await Promise.all([aStarted.promise, bStarted.promise]);
    a.controller.abort(new GenerationExecutionStopped("obsolete"));
    releaseB();
    expect(await failedA).toMatchObject({ error: { reason: "obsolete" } });
    expect((await resultB).result).toMatchObject({ channel: "MIDNIGHT" });
    expect((await ordinary).result).toMatchObject({ channel: "MIDNIGHT" });
    expect(state.review).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(b.controller.signal.aborted).toBe(false);
    expect(getGenerationExecutionContext()).toBeUndefined();
  });
});

describe("generation result and audit fences", () => {
  it("stops before inserting an audit when cancellation arrives during audit configuration lookup", async () => {
    const { ctx, controller } = execution();
    const lookupStarted = deferred();
    const release = deferred();
    state.auditConfig.mockImplementationOnce(async () => { lookupStarted.resolve(); await release.promise; return state.chat[0]; });
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse()));
    const work = runWithGenerationExecution(ctx, () => classifyContentWithFallback({ content: "synthetic input" }));
    const rejected = expect(work).rejects.toMatchObject({ reason: "obsolete" });
    await lookupStarted.promise;
    controller.abort(new GenerationExecutionStopped("obsolete"));
    release.resolve();
    await rejected;
    expect(state.review).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a cancelled result after an already-started audit completes without inserting another fallback audit", async () => {
    const { ctx, controller } = execution();
    const auditStarted = deferred();
    const release = deferred();
    state.review.mockImplementationOnce(async () => { auditStarted.resolve(); await release.promise; return { id: "synthetic-review" }; });
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse()));
    const work = runWithGenerationExecution(ctx, () => classifyContentWithFallback({ content: "synthetic input" }));
    const rejected = expect(work).rejects.toMatchObject({ reason: "shutdown" });
    await auditStarted.promise;
    controller.abort(new GenerationExecutionStopped("shutdown"));
    release.resolve();
    await rejected;
    expect(state.review).toHaveBeenCalledTimes(1);
    // Cancellation cannot revoke an insert already in progress; this asserts
    // the post-insert fence and absence of a second fallback, not rollback.
  });
});
