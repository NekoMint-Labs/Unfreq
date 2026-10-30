import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { getChatProviderPrompt } from "../../src/modules/ai/provider-prompts.js";
import {
  fixtureClassification,
  fixtureExpansion,
  fixtureFingerprint,
  fixtureMaterial,
  fixtureReview,
} from "./fixtures.js";

export type ProviderRequestHold = {
  received: Promise<void>;
  release: () => void;
};

type InternalHold = ProviderRequestHold & {
  notifyReceived: () => void;
  released: Promise<void>;
};

export type ProviderTask =
  "signal-material" | "signal-intent-analysis" | "signal-fingerprint" |
  "signal-expansion" | "signal-expansion-review" | "unsupported" | "invalid";
export type ProviderRequestEvent = {
  seq: number;
  task: ProviderTask;
  event: "received" | "completed" | "closed";
  at: number;
  elapsedMs: number;
};

export type IntegrationProvider = {
  setMatchScores: (scores: Record<string, number>) => void;
  readonly matchDispatches: readonly { kind: "embedding" | "reranker"; ids: string[]; requestBytes: number; textHashes: string[] }[];
  setRerankFixture: (mode: "percent" | "partial") => void;
  readonly rerankCalls: number;
  origin: string;
  tasks: string[];
  readonly requestEvents: readonly ProviderRequestEvent[];
  readonly requestEventsDropped: number;
  blockedRequests: string[];
  readonly inFlight: number;
  holdNextRequest: () => ProviderRequestHold;
  releaseAll: () => void;
  close: () => Promise<void>;
};

const taskOutputs: Record<Exclude<ProviderTask, "unsupported" | "invalid">, unknown> = {
  "signal-material": fixtureMaterial,
  "signal-intent-analysis": fixtureClassification,
  "signal-fingerprint": fixtureFingerprint,
  "signal-expansion": fixtureExpansion,
  "signal-expansion-review": fixtureReview,
};

export async function createProviderStub(): Promise<IntegrationProvider> {
  const tasks: string[] = [];
  const requestEvents: ProviderRequestEvent[] = [];
  let requestSequence = 0;
  let requestEventsDropped = 0;
  const holds = new Set<InternalHold>();
  const queuedHolds: InternalHold[] = [];
  const sockets = new Set<Socket>();
  const promptTasks = new Map(Object.keys(taskOutputs).map((task) => [
    getChatProviderPrompt(task), task as Exclude<ProviderTask, "unsupported" | "invalid">,
  ]));
  let inFlight = 0;
  let rerankMode: "percent" | "partial" = "percent";
  let rerankCalls = 0;
  let matchScores: Record<string, number> = {};
  const matchDispatches: Array<{ kind: "embedding" | "reranker"; ids: string[]; requestBytes: number; textHashes: string[] }> = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "POST" && (request.url === "/v1/embeddings" || request.url === "/v1/rerank") && request.headers.authorization === "Bearer E3-STUB-ONLY") {
        inFlight += 1;
        try {
          let raw = "";
          for await (const chunk of request) { raw += chunk; if (raw.length > 128000) throw new Error("Oversized E3 fixture request."); }
          const body = JSON.parse(raw) as { model?: string; dimensions?: number; input?: string[]; query?: string; candidates?: Array<{ id: string; expandedText: string }> };
          const hash = (text: string) => createHash("sha256").update(text).digest("hex");
          if (request.url === "/v1/embeddings" && body.model === "e3-embedding-fixed" && body.input?.length === 1) {
            if (!Number.isInteger(body.dimensions) || body.dimensions! < 2 || body.dimensions! > 4096) throw new Error("Invalid E3 fixture dimensions.");
            matchDispatches.push({ kind: "embedding", ids: [], requestBytes: Buffer.byteLength(raw), textHashes: body.input.map(hash) });
            response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: body.model,
              data: [{ embedding: [1, ...Array<number>(body.dimensions! - 1).fill(0)] }], usage: { total_tokens: 12 } }));
          } else if (request.url === "/v1/rerank" && body.model === "e3-rerank-fixed" && Array.isArray(body.candidates) && body.candidates.length <= 100) {
            matchDispatches.push({ kind: "reranker", ids: body.candidates.map((item) => item.id), requestBytes: Buffer.byteLength(raw),
              textHashes: [hash(body.query ?? ""), ...body.candidates.map((item) => hash(item.expandedText))] });
            response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: body.model, usage: { total_tokens: 12 },
              results: body.candidates.map((item) => ({ id: item.id, score: matchScores[item.id] ?? 0 })) }));
          } else response.writeHead(400).end();
        } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
        finally { inFlight -= 1; }
        return;
      }
      if (request.method === "POST" && request.url === "/v1/rerank") {
        inFlight += 1;
        try {
          let raw = "";
          for await (const chunk of request) { raw += chunk; if (raw.length > 128_000) throw new Error("Oversized synthetic rerank request."); }
          const body = JSON.parse(raw) as { candidates?: Array<{ id: string }>; model?: string };
          if (body.model !== "e2-reranker" || !Array.isArray(body.candidates) || body.candidates.length !== 2 || body.candidates.some((item) => typeof item.id !== "string")) {
            throw new Error("Invalid synthetic rerank fixture.");
          }
          rerankCalls += 1;
          const results = body.candidates.map((item, index) => ({ id: item.id, score: index === 0 ? 80 : 20 }));
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "e2-reranker-actual",
            results: rerankMode === "partial" ? results.slice(0, 1) : results, meta: { tokens: { input_tokens: 12, output_tokens: 0 } } }));
        } catch { response.writeHead(400).end(); }
        finally { inFlight -= 1; }
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      inFlight += 1;
      const seq = ++requestSequence;
      const startedAt = performance.now();
      let task: ProviderTask = "invalid";
      let receivedRecorded = false;
      const record = (event: ProviderRequestEvent["event"]) => {
        requestEvents.push({ seq, task, event, at: Date.now(), elapsedMs: Math.max(0, performance.now() - startedAt) });
        if (requestEvents.length > 256) {
          requestEvents.splice(0, requestEvents.length - 256);
          requestEventsDropped += 1;
        }
      };
      const received = () => {
        if (receivedRecorded) return;
        receivedRecorded = true;
        record("received");
      };
      // These are local ServerResponse lifecycle observations. A finish event
      // does not prove that the client consumed the response or paid work ended.
      response.once("finish", () => { record("completed"); });
      response.once("close", () => { record("closed"); });
      try {
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 128_000) throw new Error("Synthetic provider request is too large.");
        }
        const body = JSON.parse(raw) as { messages?: Array<{ content?: unknown; role?: string }> };
        const prompt = body.messages?.find((message) => message.role === "system")?.content;
        const resolvedTask = typeof prompt === "string" ? promptTasks.get(prompt) : undefined;
        if (resolvedTask === undefined) {
          task = "unsupported";
          tasks.push("unsupported");
          received();
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unsupported synthetic task" }));
          return;
        }
        task = resolvedTask;
        tasks.push(task);
        received();
        const hold = queuedHolds.shift();
        if (hold !== undefined) {
          hold.notifyReceived();
          await hold.released;
        }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(taskOutputs[task]), role: "assistant" } }],
        }));
      } catch {
        received();
        if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
        if (!response.writableEnded) response.end(JSON.stringify({ error: "Invalid synthetic request" }));
      } finally {
        inFlight -= 1;
      }
    })();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const releaseAll = () => {
    for (const hold of [...holds]) hold.release();
  };
  return {
    setMatchScores(scores) { matchScores = { ...scores }; },
    matchDispatches,
    setRerankFixture(mode) { rerankMode = mode; },
    get rerankCalls() { return rerankCalls; },
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tasks,
    requestEvents,
    get requestEventsDropped() { return requestEventsDropped; },
    blockedRequests: [],
    get inFlight() { return inFlight; },
    holdNextRequest() {
      let notifyReceived!: () => void;
      let releasePromise!: () => void;
      const received = new Promise<void>((resolve) => { notifyReceived = resolve; });
      const released = new Promise<void>((resolve) => { releasePromise = resolve; });
      const hold: InternalHold = {
        received,
        released,
        notifyReceived,
        release() {
          releasePromise();
          holds.delete(hold);
          const queuedIndex = queuedHolds.indexOf(hold);
          if (queuedIndex !== -1) queuedHolds.splice(queuedIndex, 1);
        },
      };
      holds.add(hold);
      queuedHolds.push(hold);
      return { received, release: hold.release };
    },
    releaseAll,
    async close() {
      releaseAll();
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
