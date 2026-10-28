import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("frontend diagnostic routes", () => {
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
