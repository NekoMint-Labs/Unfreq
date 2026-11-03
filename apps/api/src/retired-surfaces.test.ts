import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("retired product surface boundary", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    "/api/channels", "/api/channels/midnight",
    "/api/voices", "/api/voices/example",
    "/api/bottles", "/api/bottles/example",
    "/api/translate", "/api/translate/example",
    "/api/radio-report", "/api/radio-report/example",
    "/api/ai", "/api/ai/classify",
  ])("keeps %s absent for reads and writes", async (url) => {
    for (const method of ["GET", "POST"] as const) {
      expect(app.hasRoute({ method, url })).toBe(false);
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
    }
  });

  it("preserves registered capabilities even when they have no page entry", () => {
    for (const route of [
      { method: "GET", url: "/api/signals/hall" },
      { method: "GET", url: "/api/signals/:id/echoes" },
      { method: "POST", url: "/api/signals/:id/echoes" },
      { method: "GET", url: "/api/theme-radio/current" },
      { method: "POST", url: "/api/admin/theme-radio-days/" },
      { method: "POST", url: "/api/admin/ai-signals/generate" },
      { method: "POST", url: "/api/images/" },
      { method: "GET", url: "/api/images/:id" },
    ] as const) {
      expect(app.hasRoute(route), `${route.method} ${route.url}`).toBe(true);
    }
  });
});
