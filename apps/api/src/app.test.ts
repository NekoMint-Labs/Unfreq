import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe("browser administration CORS", () => {
  it.each(["PATCH", "PUT", "DELETE"])("allows %s from the configured Web origin", async (method) => {
    app = await buildApp();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/reports/00000000-0000-4000-8000-000000000001",
      headers: {
        origin: env.webOrigin,
        "access-control-request-method": method,
        "access-control-request-headers": "content-type",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(env.webOrigin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(response.headers["access-control-allow-methods"]).split(/\s*,\s*/)).toContain(method);
  });

  it("keeps the configured origin and administrator authentication boundary", async () => {
    app = await buildApp();
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/reports/00000000-0000-4000-8000-000000000001",
      headers: { origin: "https://untrusted.invalid", "access-control-request-method": "PATCH" },
    });
    expect(preflight.headers["access-control-allow-origin"]).toBe(env.webOrigin);
    const mutation = await app.inject({
      method: "PATCH",
      url: "/api/admin/reports/00000000-0000-4000-8000-000000000001",
      headers: { origin: env.webOrigin },
      payload: { status: "REJECTED", resolution: "SYNTHETIC_REVIEW_ONLY" },
    });
    expect(mutation.statusCode).toBe(401);
    expect(mutation.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("API app logger", () => {
  it("silences the default logger in test", async () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write");
    const stderrWrite = vi.spyOn(process.stderr, "write");
    const testApp = await buildApp();
    app = testApp;

    await testApp.inject({
      method: "GET",
      url: "/health",
    });

    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("allows tests to capture structured request logs when needed", async () => {
    const logLines: string[] = [];
    const testApp = await buildApp({
      logger: {
        level: "info",
        stream: {
          write(message) {
            logLines.push(message);
          },
        },
      },
    });
    app = testApp;

    await testApp.inject({
      method: "GET",
      url: "/health",
    });

    expect(logLines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: expect.any(Number),
          method: "GET",
          msg: "request completed",
          requestId: expect.any(String),
          route: "/health",
          statusCode: 200,
        }),
      ]),
    );
  });
});
