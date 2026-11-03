import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import { frontendDiagnosticRoutes } from "./routes.js";

const budget = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("../../shared/abuse-control.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../shared/abuse-control.js")>(), getAbuseGuard: () => budget,
}));
beforeEach(() => { budget.consume.mockReset().mockResolvedValue(undefined); });

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function fixture() {
  const logs: string[] = [];
  const app = Fastify({ disableRequestLogging: true, logger: { level: "warn", stream: { write: (line: string) => { logs.push(line); } } } });
  apps.push(app);
  await app.register(frontendDiagnosticRoutes, { prefix: "/api/frontend-diagnostics" });
  return { app, logs };
}
const payload = { correlationId: "synthetic_correlation", message: "Synthetic harmless error.", name: "TypeError", route: "/galaxy", source: "client-runtime" };
describe("diagnostic log privacy", () => {
  it("preserves anonymous accepted response and correlation compatibility", async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: "POST", url: "/api/frontend-diagnostics/errors", payload });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ data: { accepted: true, correlationId: payload.correlationId } });
  });
  it("keeps every client free-text representation out of server logs", async () => {
    const { app, logs } = await fixture();
    const marker = "SYNTHETIC_DIAGNOSTIC_PRIVATE_MARKER";
    const response = await app.inject({ method: "POST", url: "/api/frontend-diagnostics/errors", payload: {
      ...payload, correlationId: marker, message: marker, name: marker, digest: marker, requestId: marker, route: `/${marker}`,
    } });
    expect(response.statusCode).toBe(202);
    expect(logs.join("")).not.toContain(marker);
    expect(logs.join("")).toContain("frontend.error.report");
    const entry = JSON.parse(logs.find((line) => line.includes("frontend.error.report"))!);
    expect(entry.diagnosticFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(entry.source).toBe("client-runtime");
  });
  it("charges shared IP and site budgets before malformed JSON parsing", async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: "POST", url: "/api/frontend-diagnostics/errors",
      headers: { "content-type": "application/json" }, payload: "{invalid-json" });
    expect(response.statusCode).toBe(400);
    expect(budget.consume).toHaveBeenCalledWith([
      { rule: "diagnosticIp", identity: "127.0.0.1" }, { rule: "diagnosticSite", identity: "site" },
    ]);
  });
  it("rejects the shared budget without writing a diagnostic event", async () => {
    const { app, logs } = await fixture();
    budget.consume.mockRejectedValueOnce(new AppError("RATE_LIMITED", "Request limit reached.", { retryAfterSeconds: 2 }));
    const response = await app.inject({ method: "POST", url: "/api/frontend-diagnostics/errors", payload });
    expect(response.statusCode).toBe(429);
    expect(logs.join("")).not.toContain("frontend.error.report");
  });
  it("bounds the raw diagnostic body without logging its contents", async () => {
    const { app, logs } = await fixture();
    const marker = "SYNTHETIC_TOO_LARGE_PRIVATE_MARKER";
    const response = await app.inject({ method: "POST", url: "/api/frontend-diagnostics/errors",
      payload: { ...payload, message: marker.repeat(200) } });
    expect(response.statusCode).toBe(413);
    expect(logs.join("")).not.toContain(marker);
  });
});
