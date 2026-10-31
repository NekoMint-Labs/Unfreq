import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiLogRedactionPaths, safeErrorType } from "./log-redaction.js";

const cases = [
  { production: false, mode: "local-log", delivered: false },
  { production: false, mode: "disabled", delivered: false },
  { production: true, mode: "disabled", delivered: false },
  { production: true, mode: "local-log", delivered: false },
];
const ownedApps: FastifyInstance[] = [];
const fixtures: { app: FastifyInstance; lines: string[] }[] = [];
const errorLines: string[] = [];
let errorApp: FastifyInstance;
beforeAll(async () => {
  // Construct each actual logging configuration outside the unchanged 5s
  // behavior cases. No service connection or business operation is prepared.
  for (const { production, mode } of cases) {
    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", redact: {
      paths: apiLogRedactionPaths({ isProduction: production, authLoginDeliveryMode: mode }), censor: "[redacted]",
    }, stream: { write(line: string) { lines.push(line); } } } });
    ownedApps.push(app);
    fixtures.push({ app, lines });
    await app.ready();
  }
  errorApp = Fastify({ logger: { stream: { write(line: string) { errorLines.push(line); } } } });
  ownedApps.push(errorApp);
  await errorApp.ready();
});
afterAll(async () => { await Promise.all(ownedApps.map((app) => app.close())); });

describe("API log delivery and privacy", () => {
  it.each(cases.map((config, index) => ({ ...config, index })))("keeps delivery=$delivered for production=$production and mode=$mode", ({ delivered, index }) => {
    const { app, lines } = fixtures[index]!;
    app.log.info({ loginChallengeCode: "654321", password: "SYNTHETIC_PASSWORD", apiKey: "SYNTHETIC_API_KEY",
        passwordHash: "SYNTHETIC_HASH", seedText: "SYNTHETIC_PRIVATE_SEED", rawInput: "SYNTHETIC_RAW_INPUT",
        expandedText: "SYNTHETIC_EXPANSION", prompt: "SYNTHETIC_PROMPT", messages: ["SYNTHETIC_MESSAGES"],
        err: Object.assign(new Error("SYNTHETIC_DRIVER_MESSAGE"), { command: { args: ["SYNTHETIC_CREDENTIAL"] } }),
        error: { detail: "SYNTHETIC_ERROR_DETAIL" }, stack: "SYNTHETIC_STACK",
        context: { seedText: "SYNTHETIC_CONTEXT_SEED", rawInput: "SYNTHETIC_CONTEXT_INPUT", passwordHash: "SYNTHETIC_CONTEXT_HASH" },
        headers: { cookie: "SYNTHETIC_COOKIE", authorization: "SYNTHETIC_AUTH" },
        body: { password: "SYNTHETIC_BODY_PASSWORD", code: "SYNTHETIC_BODY_CODE" },
    }, "synthetic controlled delivery");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry.loginChallengeCode).toBe(delivered ? "654321" : "[redacted]");
    expect(lines[0]).not.toContain("SYNTHETIC_");
    expect(lines[0]).not.toContain("654321");
  });

  it("logs a fixed error type without copying an arbitrary name or driver error fields", () => {
    const error = Object.assign(new Error("SYNTHETIC_PRIVATE_MESSAGE"), {
      name: "SYNTHETIC_PRIVATE_NAME", stack: "SYNTHETIC_PRIVATE_STACK",
      detail: "SYNTHETIC_DRIVER_DETAIL", query: "SYNTHETIC_SQL",
    });
    expect(safeErrorType(error)).toBe("Error");
    expect(safeErrorType(Object.assign(new Error("private"), { name: "PostgresError" }))).toBe("PostgresError");
    expect(safeErrorType(Object.assign(new Error("private"), { name: "ReplyError" }))).toBe("ReplyError");
    expect(safeErrorType({ name: "SYNTHETIC_OBJECT_NAME" })).toBe("Error");
    errorApp.log.warn({ action: "redis.connection.failed", errorType: safeErrorType(error) }, "redis connection error");
    expect(JSON.parse(errorLines[0])).toMatchObject({ action: "redis.connection.failed", errorType: "Error" });
    expect(errorLines.join("")).not.toContain("SYNTHETIC_");
  });
});
