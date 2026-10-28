import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
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

export type IntegrationProvider = {
  origin: string;
  tasks: string[];
  blockedRequests: string[];
  readonly inFlight: number;
  holdNextRequest: () => ProviderRequestHold;
  releaseAll: () => void;
  close: () => Promise<void>;
};

const taskOutputs: Record<string, unknown> = {
  "signal-material": fixtureMaterial,
  "signal-intent-analysis": fixtureClassification,
  "signal-fingerprint": fixtureFingerprint,
  "signal-expansion": fixtureExpansion,
  "signal-expansion-review": fixtureReview,
};

export async function createProviderStub(): Promise<IntegrationProvider> {
  const tasks: string[] = [];
  const holds = new Set<InternalHold>();
  const queuedHolds: InternalHold[] = [];
  const sockets = new Set<Socket>();
  const promptTasks = new Map(Object.keys(taskOutputs).map((task) => [getChatProviderPrompt(task), task]));
  let inFlight = 0;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      inFlight += 1;
      try {
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 128_000) throw new Error("Synthetic provider request is too large.");
        }
        const body = JSON.parse(raw) as { messages?: Array<{ content?: unknown; role?: string }> };
        const prompt = body.messages?.find((message) => message.role === "system")?.content;
        const task = typeof prompt === "string" ? promptTasks.get(prompt) : undefined;
        if (task === undefined) {
          tasks.push("unsupported");
          response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unsupported synthetic task" }));
          return;
        }
        tasks.push(task);
        const hold = queuedHolds.shift();
        if (hold !== undefined) {
          hold.notifyReceived();
          await hold.released;
        }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(taskOutputs[task]), role: "assistant" } }],
        }));
      } catch {
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
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tasks,
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
