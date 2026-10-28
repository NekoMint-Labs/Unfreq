import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "./error-handler.js";
import { AppError } from "./errors.js";
import { safeRequestId } from "./request-identity.js";

const ownedApps: FastifyInstance[] = [];
beforeAll(async () => {
  // Keep real Fastify cold setup outside the behavior case's unchanged 5s
  // budget, matching an application which is ready before accepting traffic.
  const setup = Fastify({ logger: false });
  setup.get("/setup", () => ({ ok: true }));
  try { await setup.ready(); await setup.inject({ method: "GET", url: "/setup" }); }
  finally { await setup.close(); }
});
function errorApp() {
  const logs: string[] = [];
  const app = Fastify({
    disableRequestLogging: true,
    logger: { level: "warn", stream: { write(line: string) { logs.push(line); } } },
    genReqId: (request) => safeRequestId(request.headers["x-request-id"]),
  });
  app.setErrorHandler(errorHandler);
  ownedApps.push(app);
  return { app, logs };
}
afterEach(async () => {
  await Promise.all(ownedApps.splice(0).map((app) => app.close()));
});

describe("real Fastify error response and logging boundary", () => {
  it.each([
    { seconds: 0.01, expected: "1" },
    { seconds: 1.01, expected: "2" },
    { seconds: 2, expected: "2" },
    { seconds: 0, expected: "1" },
    { seconds: -1, expected: "1" },
    { seconds: Number.MAX_SAFE_INTEGER, expected: "2147483647" },
  ])("returns positive ceil Retry-After=$expected for requested $seconds while preserving the response", async ({ seconds, expected }) => {
    const { app } = errorApp();
    app.get("/limited", () => {
      throw new AppError("RATE_LIMITED", "Synthetic request limit reached.", { retryAfterSeconds: seconds, rule: "synthetic" });
    });
    const response = await app.inject({ method: "GET", url: "/limited", headers: { "x-request-id": "trace-rate-limit" } });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe(expected);
    expect(response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Synthetic request limit reached.", details: { retryAfterSeconds: seconds, rule: "synthetic" } },
      meta: { requestId: "trace-rate-limit" },
    });
  });

  it("defaults a missing retry time to one second without adding response details", async () => {
    const { app } = errorApp();
    app.get("/limited", () => { throw new AppError("RATE_LIMITED", "Synthetic request limit reached."); });
    const response = await app.inject({ method: "GET", url: "/limited" });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json().error).toEqual({ code: "RATE_LIMITED", message: "Synthetic request limit reached." });
  });

  it("does not add Retry-After to an ordinary application error", async () => {
    const { app } = errorApp();
    app.get("/conflict", () => { throw new AppError("CONFLICT", "Synthetic conflict.", { id: "synthetic" }); });
    const response = await app.inject({ method: "GET", url: "/conflict" });
    expect(response.statusCode).toBe(409);
    expect(response.headers).not.toHaveProperty("retry-after");
    expect(response.json().error).toEqual({ code: "CONFLICT", message: "Synthetic conflict.", details: { id: "synthetic" } });
  });

  it.each([
    { name: "PostgresError", expectedType: "PostgresError" },
    { name: "synthetic-private-error-name", expectedType: "Error" },
  ])("logs only an allowed error type for unexpected $name", async ({ name, expectedType }) => {
    const { app, logs } = errorApp();
    const privateValues = ["synthetic-private-message", "synthetic-private-stack", "synthetic-private-driver"];
    const error = Object.assign(new Error(privateValues[0]), {
      name, stack: privateValues[1],
      details: { driver: privateValues[2], query: "synthetic-private-query" },
      connection: { password: privateValues[2] },
    });
    app.get("/unexpected", () => { throw error; });
    const response = await app.inject({ method: "GET", url: "/unexpected", headers: { "x-request-id": "trace-unexpected" } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error." },
      meta: { requestId: "trace-unexpected" },
    });
    const unexpected = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "unexpected api error");
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]).toMatchObject({ errorType: expectedType, requestId: "trace-unexpected" });
    for (const marker of [...privateValues, "synthetic-private-query"]) {
      expect(logs.join("")).not.toContain(marker);
      expect(response.body).not.toContain(marker);
    }
    if (expectedType === "Error") expect(logs.join("")).not.toContain(name);
    expect(unexpected[0]).not.toHaveProperty("err");
    expect(unexpected[0]).not.toHaveProperty("stack");
    expect(unexpected[0]).not.toHaveProperty("details");
  });

  it("omits internal AppError messages, stacks and driver details from logs", async () => {
    const { app, logs } = errorApp();
    const error = new AppError("INTERNAL_ERROR", "synthetic-private-internal-message", {
      boundary: "provider_call", kind: "network_error", driver: "synthetic-private-driver",
    });
    error.stack = "synthetic-private-internal-stack";
    app.get("/internal", () => { throw error; });
    const response = await app.inject({ method: "GET", url: "/internal" });
    expect(response.statusCode).toBe(500);
    const application = logs.map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === "application error");
    expect(application).toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500, failureBoundary: "provider_call", failureKind: "network_error" });
    for (const marker of ["synthetic-private-internal-message", "synthetic-private-internal-stack", "synthetic-private-driver"]) {
      expect(logs.join("")).not.toContain(marker);
    }
  });

  it("uses the replaced request ID in both the error envelope and safe log correlation", async () => {
    const { app, logs } = errorApp();
    app.get("/unexpected", () => { throw new Error("synthetic-private-request-failure"); });
    const header = "private-request-id-".repeat(10);
    const response = await app.inject({ method: "GET", url: "/unexpected", headers: { "x-request-id": header } });
    const requestId = response.json().meta.requestId as string;
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(logs.join("")).not.toContain(header);
    expect(logs.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(expect.objectContaining({ requestId }));
  });

  it("preserves the validation-error envelope through the installed Fastify handler", async () => {
    const { app } = errorApp();
    app.post("/validated", {
      schema: { body: { type: "object", required: ["count"], properties: { count: { type: "integer" } } } },
    }, () => ({ ok: true }));
    const response = await app.inject({ method: "POST", url: "/validated", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: "VALIDATION_ERROR", message: "Invalid request." });
    expect(response.json().error.details).toBeInstanceOf(Array);
    expect(response.headers).not.toHaveProperty("retry-after");
  });
});
