import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertManagedIntegrationEnvironment, configureIsolatedEnvironment, installFetchBoundary } from "./harness.js";

async function createFailingSocket() {
  // A TCP RST is intentional here. A clean FIN during startup has a separate
  // diagnostic because postgres 3.4.9 can reconnect without settling the query.
  // Own both endpoints; never stop or alter the runner's healthy services.
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.resetAndDestroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  };
}

describe("real dependency TCP resets during startup handshake", () => {
  let app: FastifyInstance | undefined;
  let databaseFault: Awaited<ReturnType<typeof createFailingSocket>> | undefined;
  let redisFault: Awaited<ReturnType<typeof createFailingSocket>> | undefined;
  let restoreEnvironment: (() => Promise<void>) | undefined;
  let restoreFetch: ReturnType<typeof installFetchBoundary> | undefined;
  const syntheticSecret = "integration_fault_connection_secret";

  beforeAll(async () => {
    const managed = assertManagedIntegrationEnvironment();
    databaseFault = await createFailingSocket();
    redisFault = await createFailingSocket();
    restoreEnvironment = await configureIsolatedEnvironment({
      ...managed,
      databaseUrl: `postgres://unfreq_test:${syntheticSecret}@127.0.0.1:${databaseFault.port}/unfreq_integration`,
      redisUrl: `redis://127.0.0.1:${redisFault.port}`,
    });
    restoreFetch = installFetchBoundary();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await databaseFault?.close();
      await redisFault?.close();
      restoreFetch?.();
      await restoreEnvironment?.();
    }
    expect(restoreFetch?.blockedRequests ?? []).toHaveLength(0);
  });

  it("keeps liveness available while PostgreSQL and Redis startup handshakes receive TCP RST", async () => {
    const live = await app!.inject({ method: "GET", url: "/health" });
    expect(live.statusCode).toBe(200);
    expect(live.json().data.status).toBe("ok");
    const deep = await app!.inject({ method: "GET", url: "/health/deep" });
    expect(deep.statusCode).toBe(503);
    expect(deep.json().data.dependencies).toEqual({ postgres: "unavailable", redis: "unavailable" });
    expect(deep.body).not.toContain(syntheticSecret);
    expect(deep.body).not.toContain("postgres://");
    expect(deep.body).not.toContain("redis://");
    expect((await app!.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("returns a generic API error when a query's database startup handshake receives TCP RST", async () => {
    const failed = await app!.inject({ method: "POST", url: "/api/auth/register", payload: { password: "synthetic-password-only" } });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error.code).toBe("INTERNAL_ERROR");
    expect(failed.body).not.toContain(syntheticSecret);
    expect(failed.body).not.toContain("127.0.0.1");
    expect(failed.body).not.toContain("postgres://");
  });
});
