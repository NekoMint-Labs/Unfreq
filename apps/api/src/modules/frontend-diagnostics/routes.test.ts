import { afterEach, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

let app: FastifyInstance | undefined;

beforeAll(async () => {
  // Warm Fastify's cold internals outside the unchanged 5s behavior budget.
  const setup = Fastify({ logger: false });
  setup.get("/setup", () => ({ ok: true }));
  try { await setup.ready(); await setup.inject({ method: "GET", url: "/setup" }); }
  finally { await setup.close(); }
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("frontend diagnostic routes", () => {
  it("logs only a keyed fingerprint and fixed metadata when accepted text contains private material", async () => {
    const logs: string[] = [];
    const testApp = await buildApp({ logger: { level: "info", stream: { write(line: string) { logs.push(line); } } } });
    app = testApp;
    const privateSeed = "SYNTHETIC_PRIVATE_SEED_完整合成表达";
    const response = await testApp.inject({ method: "POST", url: "/api/frontend-diagnostics/errors", payload: {
      correlationId: "synthetic-private-correlation",
      message: `${privateSeed} password=SYNTHETIC_PASSWORD code=654321`,
      name: "SYNTHETIC_PRIVATE_NAME", route: "/SYNTHETIC_PRIVATE_ROUTE", source: "client-runtime",
    } });
    expect(response.statusCode).toBe(202);
    const diagnostic = logs.map((line) => JSON.parse(line)).find((entry) => entry.action === "frontend.error.report");
    expect(diagnostic).toMatchObject({ diagnosticFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      source: "client-runtime", requestId: expect.any(String) });
    for (const value of [privateSeed, "SYNTHETIC_PASSWORD", "654321", "SYNTHETIC_PRIVATE_NAME", "SYNTHETIC_PRIVATE_ROUTE", "synthetic-private-correlation"]) {
      expect(logs.join("")).not.toContain(value);
    }
    expect(diagnostic).not.toHaveProperty("message");
    expect(diagnostic).not.toHaveProperty("route");
  });

  it("accepts frontend error diagnostics without a session", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        correlationId: "web_test-123",
        message: "Cannot read properties of undefined.",
        name: "TypeError",
        route: "/signals/00000000-0000-4000-8000-000000000201",
        source: "client-runtime",
      },
      url: "/api/frontend-diagnostics/errors",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      data: {
        accepted: true,
        correlationId: "web_test-123",
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });

  it("rejects diagnostics that try to send cookies", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        cookie: "unfreq_session=secret",
        correlationId: "web_test-456",
        message: "Something failed.",
        name: "Error",
        route: "/galaxy",
        source: "route-error",
      },
      url: "/api/frontend-diagnostics/errors",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("rejects routes with query strings", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        correlationId: "web_test-789",
        message: "Route error.",
        name: "Error",
        route: "/signals/00000000-0000-4000-8000-000000000201?email=a@example.com",
        source: "route-error",
      },
      url: "/api/frontend-diagnostics/errors",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });
});
