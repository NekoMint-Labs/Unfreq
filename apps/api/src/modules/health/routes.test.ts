import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health routes", () => {
  it("returns the shared success envelope for /health", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        service: "api",
        status: "ok",
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });
});
