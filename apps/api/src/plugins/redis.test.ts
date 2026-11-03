import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { redisPlugin } from "./redis.js";

const state = vi.hoisted(() => ({ onError: undefined as ((error: unknown) => void) | undefined, disconnect: vi.fn() }));
vi.mock("ioredis", () => ({ Redis: class {
  on(event: string, callback: (error: unknown) => void) { if (event === "error") state.onError = callback; }
  disconnect() { state.disconnect(); }
} }));
afterEach(() => { state.onError = undefined; state.disconnect.mockReset(); });

const logs: string[] = [];
let app: FastifyInstance;
beforeAll(async () => {
  // Prepare the real plugin before measuring the error event/log boundary.
  // The behavior test keeps Vitest's unchanged 5s budget.
  app = Fastify({ logger: { level: "warn", stream: { write(line: string) { logs.push(line); } } } });
  await app.register(redisPlugin);
  await app.ready();
});
afterAll(async () => { await app?.close(); });

describe("Redis dependency logging boundary", () => {
  it("logs a stable diagnostic without serializing driver messages, stack or command arguments", async () => {
    try {
      expect(state.onError).toBeTypeOf("function");
      state.onError?.(Object.assign(new Error("SYNTHETIC_REDIS_URL_PASSWORD"), {
        name: "SYNTHETIC_PRIVATE_TYPE", stack: "SYNTHETIC_STACK", command: { name: "auth", args: ["SYNTHETIC_SECRET"] },
      }));
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0])).toMatchObject({ action: "redis.connection.failed", errorType: "Error" });
      expect(logs[0]).not.toContain("SYNTHETIC_");
      expect(JSON.parse(logs[0])).not.toHaveProperty("err");
    } finally { await app.close(); }
    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });
});
