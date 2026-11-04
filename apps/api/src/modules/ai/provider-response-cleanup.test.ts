import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callChatProvider } from "./provider-transport.js";
import { generateEmbedding } from "./embedding.js";
import { rerankCandidates } from "./reranker.js";
import { testProviderConfig } from "./provider-health.js";
import { disposeProviderResponse } from "./provider-response-cleanup.js";
import { GenerationExecutionStopped, runWithGenerationExecution } from "../../shared/generation-execution.js";

const state = vi.hoisted(() => ({ origin: "http://127.0.0.1:1" }));
vi.mock("../../shared/abuse-control.js", () => ({ authorizeProviderDispatch: vi.fn(async () => {}) }));
vi.mock("./provider-config.js", () => {
  const config = (path: string) => ({ apiKey: "synthetic-loopback-only", baseUrl: `${state.origin}/${path}`,
    model: "synthetic", provider: "synthetic", dimensions: 3, version: "synthetic-v1", profile: "default" });
  return {
    resolveChatProviderConfigs: async () => [config("bad"), config("good")],
    resolveEmbeddingProviderConfigs: async () => [config("bad"), config("good")],
    resolveEmbeddingProviderConfig: async () => config("bad"),
    resolveRerankerProviderConfigs: async () => [config("bad"), config("good")],
    resolveRerankerProviderConfig: async () => config("bad"),
  };
});

const input = { queryText: "synthetic query", candidates: [{ id: "candidate", distance: 0.1, expandedText: "synthetic public text" }] };
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function streamingProvider() {
  const sockets = new Set<Socket>();
  const rejectedSockets = new Set<Socket>();
  const closedRejectedSockets = new Set<Socket>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let rejected = 0;
  let successful = 0;
  const server = createServer((request, response) => {
    request.resume();
    if (request.url?.startsWith("/bad/")) {
      rejected += 1;
      rejectedSockets.add(request.socket);
      request.socket.once("close", () => { closedRejectedSockets.add(request.socket); });
      response.writeHead(503, { "content-type": "text/plain" });
      response.write("synthetic error body that never ends\n");
      const interval = setInterval(() => { response.write("more synthetic error bytes\n"); }, 20);
      intervals.add(interval);
      response.once("close", () => { clearInterval(interval); intervals.delete(interval); });
      return;
    }
    successful += 1;
    const payload = request.url?.endsWith("/embeddings") ? { data: [{ embedding: [0.1, 0.2, 0.3] }] }
      : request.url?.endsWith("/rerank") ? { results: [{ id: "candidate", score: 0.9 }] }
      : { choices: [{ message: { content: JSON.stringify({ ok: true }) } }] };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  state.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    for (const interval of intervals) clearInterval(interval);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
  });
  return {
    get rejected() { return rejected; }, get successful() { return successful; },
    async expectRejectedTransportsClosed() {
      await expect.poll(() => closedRejectedSockets.size, { timeout: 2_000 }).toBe(rejectedSockets.size);
      expect(rejectedSockets.size).toBe(rejected);
      expect(intervals.size).toBe(0);
    },
  };
}

describe("provider HTTP response ownership", () => {
  it.each(["chat", "embedding", "reranker"] as const)("closes real endless %s error responses before leaving retries/fallback behind", async (kind) => {
    const server = await streamingProvider();
    if (kind === "chat") expect(await callChatProvider("classify", "synthetic input")).toEqual({ ok: true });
    if (kind === "embedding") expect((await generateEmbedding("synthetic input", { retryDelayMs: 0 })).embedding).toEqual([0.1, 0.2, 0.3]);
    if (kind === "reranker") expect((await rerankCandidates(input)).results).toMatchObject([{ id: "candidate", score: 0.9 }]);
    expect(server.rejected).toBe(kind === "embedding" ? 4 : 1);
    expect(server.successful).toBe(1);
    await server.expectRejectedTransportsClosed();
  });

  it.each(["chat", "embedding", "reranker"] as const)("closes the real %s configuration probe body while preserving HTTP status", async (kind) => {
    const server = await streamingProvider();
    const result = await testProviderConfig(kind, { apiKey: "synthetic-loopback-only", baseUrl: `${state.origin}/bad`, model: "synthetic", provider: "synthetic" });
    expect(result).toMatchObject({ reason: "http_error", status: "failed", detail: "Provider 返回 HTTP 503。" });
    expect(server.rejected).toBe(1);
    expect(server.successful).toBe(0);
    await server.expectRejectedTransportsClosed();
  });

  it.each(["chat", "embedding", "reranker"] as const)("cancels a received %s body when the execution fence rejects after headers", async (kind) => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ cancel: cancelled });
    const response = new Response(body, { status: 503 });
    const controller = new AbortController();
    const stopped = new GenerationExecutionStopped("obsolete");
    const fetchMock = vi.fn(async () => { controller.abort(stopped); return response; });
    vi.stubGlobal("fetch", fetchMock);
    const work = () => kind === "chat" ? callChatProvider("classify", "synthetic input")
      : kind === "embedding" ? generateEmbedding("synthetic input", { retryDelayMs: 0 }) : rerankCandidates(input);
    await expect(runWithGenerationExecution({ attemptId: "synthetic", signal: controller.signal,
      assertActive: async () => {}, beforeDispatch: async () => {} }, work)).rejects.toBe(stopped);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("aborts the owned request even if body cancellation rejects", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn(async () => { throw new Error("synthetic cancellation failure"); });
    await expect(disposeProviderResponse(new Response(new ReadableStream({ cancel: cancelled })), controller)).resolves.toBeUndefined();
    expect(controller.signal.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("leaves a fully consumed successful response alone and accepts a null body", async () => {
    const response = new Response("{\"ok\":true}");
    await response.json();
    await expect(disposeProviderResponse(response, new AbortController())).resolves.toBeUndefined();
    await expect(disposeProviderResponse(new Response(null, { status: 204 }), new AbortController())).resolves.toBeUndefined();
  });
});
