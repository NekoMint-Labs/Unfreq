import { createHash, randomUUID } from "node:crypto";
import { createConnection, createServer, type AddressInfo, type Socket } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertManagedIntegrationEnvironment, configureIsolatedEnvironment, installFetchBoundary } from "./harness.js";

type Driver = ReturnType<typeof postgres>;
type FaultMode = "startup-fin" | "array-types-fin" | "forward";
type Operation = "query" | "reserve" | "begin" | "drizzle-transaction";
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const cjsRequire = createRequire(import.meta.url);
const postgresCjs = cjsRequire("postgres") as typeof postgres;
const driverEntries = [
  { name: "ESM", factory: postgres },
  { name: "CJS", factory: postgresCjs },
] as const;

// Only relays to the already-guarded disposable PostgreSQL endpoint. FIN faults
// close our client side; no real backend is stopped or reconfigured.
async function createEofProxy(targetPort: number, initialMode: FaultMode) {
  let mode = initialMode;
  let attempts = 0;
  let arrayTypeCuts = 0;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    return socket;
  };
  const server = createServer((downstream) => {
    attempts += 1;
    track(downstream);
    const connectionMode = mode;
    if (connectionMode === "startup-fin") {
      downstream.on("data", () => {});
      downstream.end();
      return;
    }
    const upstream = track(createConnection({ host: "127.0.0.1", port: targetPort }));
    let sawReady = false;
    let cut = false;
    let serverBuffer = Buffer.alloc(0);
    let frontendBuffer = Buffer.alloc(0);
    upstream.on("error", () => downstream.destroy());
    downstream.on("error", () => upstream.destroy());
    downstream.on("close", () => upstream.destroy());
    upstream.on("end", () => downstream.end());
    downstream.on("end", () => upstream.end());
    upstream.on("data", (chunk: Buffer) => {
      // No TLS is used in these guarded loopback connections. Observe complete
      // backend protocol frames without altering or synthesizing their content.
      if (connectionMode === "array-types-fin" && !sawReady) {
        serverBuffer = Buffer.concat([serverBuffer, chunk]);
        while (serverBuffer.length >= 5) {
          const length = serverBuffer.readInt32BE(1);
          if (length < 4 || length > 16 * 1024 * 1024) {
            downstream.destroy();
            upstream.destroy();
            return;
          }
          if (serverBuffer.length < length + 1) break;
          if (serverBuffer[0] === 90) sawReady = true; // ReadyForQuery ('Z')
          serverBuffer = serverBuffer.subarray(length + 1);
        }
      }
      if (!downstream.destroyed && !cut) downstream.write(chunk);
    });
    downstream.on("data", (chunk: Buffer) => {
      if (cut) return;
      if (connectionMode !== "array-types-fin" || !sawReady) {
        upstream.write(chunk);
        return;
      }
      // Postgres.js fetch_types sends a Parse/Query containing pg_catalog.pg_type
      // after authentication. Buffer full frames so TCP fragmentation is harmless.
      frontendBuffer = Buffer.concat([frontendBuffer, chunk]);
      while (frontendBuffer.length >= 5) {
        const length = frontendBuffer.readInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) {
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (frontendBuffer.length < length + 1) break;
        const message = frontendBuffer.subarray(0, length + 1);
        frontendBuffer = frontendBuffer.subarray(length + 1);
        if ((message[0] === 80 || message[0] === 81) && message.includes(Buffer.from("pg_catalog.pg_type"))) {
          cut = true;
          arrayTypeCuts += 1;
          upstream.destroy();
          downstream.end(); // FIN during real internal type loading.
          return;
        }
        upstream.write(message);
      }
    });
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
    get attempts() { return attempts; },
    get arrayTypeCuts() { return arrayTypeCuts; },
    setMode(next: FaultMode) { mode = next; },
    async close() {
      const closed = new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      await Promise.all([...sockets].map((socket) => new Promise<void>((resolve) => {
        // Membership is removed by the actual close event. `socket.closed`
        // can become true before that event, especially for upstream sockets.
        if (!sockets.has(socket)) resolve();
        else socket.once("close", () => resolve());
        socket.destroy();
      })));
      await closed;
      expect(sockets.size).toBe(0);
    },
  };
}

async function settleOrTerminate<T>(work: PromiseLike<T>, milliseconds: number, terminate: () => Promise<void>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const settled = Promise.resolve(work).then(
    (value) => ({ state: "settled" as const, value }),
    (error: unknown) => ({ state: "rejected" as const, error }),
  );
  try {
    const outcome = await Promise.race([
      settled,
      new Promise<{ state: "pending" }>((resolve) => { timer = setTimeout(() => resolve({ state: "pending" }), milliseconds); }),
    ]);
    if (outcome.state === "pending") {
      // A failed regression must really stop its work before throwing. Returning
      // a synthetic timeout while registration keeps running would hide late writes.
      await terminate();
      await Promise.race([settled, delay(250)]);
      throw new Error("PostgreSQL EOF work remained pending; its owned client was terminated before this failure.");
    }
    if (outcome.state === "rejected") {
      await terminate();
      throw outcome.error;
    }
    return outcome.value;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runOperation(client: Driver, operation: Operation, onBusiness?: () => void) {
  if (operation === "query") {
    await client`select 1 as value`;
    onBusiness?.();
  } else if (operation === "reserve") {
    const reserved = await client.reserve();
    try { onBusiness?.(); await reserved`select 1 as value`; } finally { reserved.release(); }
  } else if (operation === "begin") {
    await client.begin(async (transaction) => { onBusiness?.(); await transaction`select 1 as value`; });
  } else {
    await drizzle(client).transaction(async (transaction) => { onBusiness?.(); await transaction.execute(drizzleSql`select 1 as value`); });
  }
}

describe("startup EOF settles real driver work and leaves no late registration", () => {
  let managed: ReturnType<typeof assertManagedIntegrationEnvironment>;
  let admin: Driver | undefined;
  let direct: Driver | undefined;
  let databaseUrl = "";
  let databaseName = "";
  let databaseCreated = false;
  let app: FastifyInstance | undefined;
  let appProxy: Awaited<ReturnType<typeof createEofProxy>> | undefined;
  let restoreEnvironment: (() => Promise<void>) | undefined;
  let restoreFetch: ReturnType<typeof installFetchBoundary> | undefined;
  let stopAppPromise: Promise<void> | undefined;

  const stopApp = () => {
    stopAppPromise ??= (async () => {
      // End the production driver's pool before closing Fastify: an in-flight
      // inject must not prevent its own database cleanup hook from being reached.
      const { closeDatabaseConnection } = await import("../../src/db/client.js");
      await closeDatabaseConnection();
      await app?.close();
    })();
    return stopAppPromise;
  };

  beforeAll(async () => {
    managed = assertManagedIntegrationEnvironment();
    const suffix = managed.runId.toLowerCase().replace(/-/gu, "_").slice(0, 24);
    const digest = createHash("sha256").update(managed.runId).digest("hex").slice(0, 8);
    databaseName = `unfreq_integration_eof_${suffix}_${digest}`;
    if (!/^unfreq_integration_eof_[a-z0-9_]{8,40}$/u.test(databaseName) || databaseName.length > 63) {
      throw new Error("Refusing an unguarded integration EOF database identifier.");
    }
    admin = postgres(managed.databaseUrl, { max: 1, prepare: false, connect_timeout: 2, ssl: false });
    const existing = await admin`select datname from pg_database where datname = ${databaseName}`;
    if (existing.length !== 0) throw new Error("EOF regression requires a fresh, independently owned database.");
    await admin`create database ${admin(databaseName)}`;
    databaseCreated = true;
    const url = new URL(managed.databaseUrl);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    direct = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 2, ssl: false });
    await migrate(drizzle(direct), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    await direct`create table unfreq_integration_eof_run (run_id text primary key)`;
    await direct`insert into unfreq_integration_eof_run values (${managed.runId})`;
    expect(await direct`select id from provider_configs`).toHaveLength(0);
    appProxy = await createEofProxy(Number(url.port), "startup-fin");
    const proxyUrl = new URL(databaseUrl);
    proxyUrl.port = String(appProxy.port);
    proxyUrl.searchParams.set("ssl", "false");
    restoreEnvironment = await configureIsolatedEnvironment({ ...managed, databaseUrl: proxyUrl.toString() });
    process.env.DB_POOL_MAX = "2";
    restoreFetch = installFetchBoundary();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    const cleanups: Array<() => Promise<unknown>> = [
      async () => { if (app !== undefined) await stopApp(); },
      async () => { await appProxy?.close(); },
      async () => { await direct?.end({ timeout: 0 }); },
      async () => {
        if (!databaseCreated || admin === undefined) return;
        const owners = await admin<{ owner: string }[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${databaseName}`;
        if (!/^unfreq_integration_eof_[a-z0-9_]{8,40}$/u.test(databaseName) || owners[0]?.owner !== "unfreq_test") {
          throw new Error("Refusing to drop an EOF regression database with unexpected ownership.");
        }
        await admin`drop database ${admin(databaseName)}`;
      },
      async () => { await admin?.end({ timeout: 0 }); },
      async () => { restoreFetch?.(); await restoreEnvironment?.(); },
    ];
    for (const cleanup of cleanups) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    expect(restoreFetch?.blockedRequests ?? []).toHaveLength(0);
    if (errors.length > 0) throw new AggregateError(errors, "EOF regression resource cleanup failed.");
  });

  it("bounds concurrent cold registration failures, stops reconnecting, and never creates old users after recovery", async () => {
    const responses = await settleOrTerminate(Promise.all(Array.from({ length: 5 }, () => app!.inject({
      method: "POST", url: "/api/auth/register", payload: { password: `eof-${randomUUID()}` },
    }))), 1800, stopApp);
    for (const response of responses) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } });
      expect(response.body).not.toContain("unfreq_integration_only");
      expect(response.body).not.toContain("postgres://");
    }
    const failedAttempts = appProxy!.attempts;
    expect(failedAttempts).toBeGreaterThan(0);
    appProxy!.setMode("forward");
    // Longer than the app driver's one-second connect_timeout. No new request
    // is issued through the proxy until these assertions finish.
    await delay(1300);
    expect(appProxy!.attempts).toBe(failedAttempts);
    const [beforeNew] = await direct!<{ users: number; frequencies: number }[]>`
      select (select count(*)::integer from users) as users,
        (select count(*)::integer from frequencies) as frequencies
    `;
    expect(beforeNew).toEqual({ users: 0, frequencies: 0 });
    const fresh = await settleOrTerminate(app!.inject({
      method: "POST", url: "/api/auth/register", payload: { password: `fresh-${randomUUID()}` },
    }), 4000, stopApp);
    expect(fresh.statusCode).toBe(201);
    const [afterNew] = await direct!<{ users: number; frequencies: number }[]>`
      select (select count(*)::integer from users) as users,
        (select count(*)::integer from frequencies) as frequencies
    `;
    expect(afterNew).toEqual({ users: 1, frequencies: 1 });
    const healthy = await settleOrTerminate(app!.inject({ method: "GET", url: "/health/deep" }), 2000, stopApp);
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json().data.dependencies).toEqual({ postgres: "ok", redis: "ok" });
  });

  for (const { name, factory } of driverEntries) {
    for (const mode of ["startup-fin", "array-types-fin"] as const) {
      it.each(["query", "reserve", "begin", "drizzle-transaction"] as const)(
        `${name} ${mode} rejects five cold %s with two pool slots and recovers without late callbacks`,
        async (operation) => {
          const proxy = await createEofProxy(Number(new URL(managed.databaseUrl).port), mode);
          const url = new URL(databaseUrl);
          url.port = String(proxy.port);
          const client = factory(url.toString(), { max: 2, prepare: false, connect_timeout: 1, fetch_types: true, ssl: false });
          const unhandled: unknown[] = [];
          const observeUnhandled = (error: unknown) => { unhandled.push(error); };
          let businessCalls = 0;
          const onBusiness = () => { businessCalls += 1; };
          process.on("unhandledRejection", observeUnhandled);
          try {
            const failures = await settleOrTerminate(Promise.allSettled(Array.from(
              { length: 5 }, () => runOperation(client, operation, onBusiness),
            )), 1800, () => client.end({ timeout: 0 }));
            expect(failures.map((failure) => failure.status)).toEqual(Array(5).fill("rejected"));
            for (const failure of failures) {
              if (failure.status === "rejected") expect(failure.reason).toMatchObject({ code: "CONNECTION_CLOSED" });
            }
            expect(businessCalls).toBe(0);
            if (mode === "array-types-fin") expect(proxy.arrayTypeCuts).toBeGreaterThan(0);
            const attempts = proxy.attempts;
            proxy.setMode("forward");
            await delay(1300);
            expect(proxy.attempts).toBe(attempts);
            expect(businessCalls).toBe(0);
            expect(unhandled).toHaveLength(0);
            // Reuse the same two-slot pool with five new operations. Failed
            // reservations/callbacks must not reappear when the backend returns.
            await settleOrTerminate(Promise.all(Array.from(
              { length: 5 }, () => runOperation(client, operation, onBusiness),
            )), 4000, () => client.end({ timeout: 0 }));
            await delay(25);
            expect(businessCalls).toBe(5);
            expect(unhandled).toHaveLength(0);
          } finally {
            try { await client.end({ timeout: 0 }); } finally {
              try { await proxy.close(); } finally { process.off("unhandledRejection", observeUnhandled); }
            }
          }
        },
      );
    }

    it(`${name} loads array types on five healthy cold reservations, releases them and reuses its two-slot pool`, async () => {
      expect(postgresCjs).not.toBe(postgres);
      expect(cjsRequire.resolve("postgres").replace(/\\/gu, "/")).toMatch(/\/postgres\/cjs\/src\/index\.js$/u);
      const proxy = await createEofProxy(Number(new URL(managed.databaseUrl).port), "forward");
      const url = new URL(databaseUrl);
      url.port = String(proxy.port);
      const client = factory(url.toString(), { max: 2, prepare: false, connect_timeout: 1, fetch_types: true, ssl: false });
      let businessCalls = 0;
      try {
        await settleOrTerminate(Promise.all(Array.from(
          { length: 5 }, () => runOperation(client, "reserve", () => { businessCalls += 1; }),
        )), 4000, () => client.end({ timeout: 0 }));
        expect(businessCalls).toBe(5);
        const rows = await settleOrTerminate(client<{ value: number; roles: string[]; numbers: number[] }[]>`
          select 1 as value, array['USER', 'ADMIN']::role[] as roles, array[1, 2, 3]::integer[] as numbers
        `, 2000, () => client.end({ timeout: 0 }));
        expect(rows[0]).toEqual({ value: 1, roles: ["USER", "ADMIN"], numbers: [1, 2, 3] });
        expect(proxy.attempts).toBe(2);
      } finally {
        try { await client.end({ timeout: 0 }); } finally { await proxy.close(); }
      }
    });
  }
});
