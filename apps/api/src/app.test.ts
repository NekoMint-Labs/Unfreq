import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
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
