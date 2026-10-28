import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { apiLogRedactionPaths } from "./log-redaction.js";

describe("API log delivery and privacy", () => {
  it.each([
    { production: false, mode: "local-log", delivered: true },
    { production: false, mode: "disabled", delivered: false },
    { production: true, mode: "disabled", delivered: false },
    { production: true, mode: "local-log", delivered: false },
  ])("keeps delivery=$delivered for production=$production and mode=$mode", async ({ production, mode, delivered }) => {
    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", redact: {
      paths: apiLogRedactionPaths({ isProduction: production, authLoginDeliveryMode: mode }), censor: "[redacted]",
    }, stream: { write(line: string) { lines.push(line); } } } });
    try {
      app.log.info({ loginChallengeCode: "654321", password: "SYNTHETIC_PASSWORD", apiKey: "SYNTHETIC_API_KEY",
        headers: { cookie: "SYNTHETIC_COOKIE", authorization: "SYNTHETIC_AUTH" },
        body: { password: "SYNTHETIC_BODY_PASSWORD", code: "SYNTHETIC_BODY_CODE" },
      }, "synthetic controlled delivery");
    } finally { await app.close(); }
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry.loginChallengeCode).toBe(delivered ? "654321" : "[redacted]");
    expect(lines[0]).not.toContain("SYNTHETIC_");
  });
});
