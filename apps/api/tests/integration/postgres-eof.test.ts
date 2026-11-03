import { createHash, randomUUID } from "node:crypto";
import { createConnection, createServer, type AddressInfo, type Socket } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import postgres, { type TransactionSql } from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertManagedIntegrationEnvironment, configureIsolatedEnvironment, installFetchBoundary } from "./harness.js";

type Driver = ReturnType<typeof postgres>;
type FaultMode = "startup-fin" | "array-types-fin" | "array-types-hang" | "commit-rollback" | "forward";
type Operation = "query" | "reserve" | "begin" | "drizzle-transaction";
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const cjsRequire = createRequire(import.meta.url);
// v4 is one ES module; Node's CommonJS interop exposes its default export.
const postgresCjs = (cjsRequire("postgres") as { default: typeof postgres }).default;
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
  let commitRollbacks = 0;
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
      if ((connectionMode === "array-types-fin" || connectionMode === "array-types-hang" || connectionMode === "commit-rollback") && !sawReady) {
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
      if ((connectionMode !== "array-types-fin" && connectionMode !== "array-types-hang" && connectionMode !== "commit-rollback") || !sawReady) {
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
        if ((connectionMode === "array-types-fin" || connectionMode === "array-types-hang") && (message[0] === 80 || message[0] === 81) && message.includes(Buffer.from("pg_catalog.pg_type"))) {
          cut = true;
          arrayTypeCuts += 1;
          upstream.destroy();
          if (connectionMode === "array-types-fin") downstream.end(); // FIN, or an owned silent type-load socket.
          return;
        }
        if (connectionMode === "commit-rollback" && message[0] === 81 &&
            message.subarray(5, -1).toString("utf8").trim().toLowerCase() === "commit") {
          // Exercise a real PostgreSQL ROLLBACK command/result at the final
          // COMMIT boundary. Only this owned test connection is altered.
          const payload = Buffer.from("rollback\0");
          const replacement = Buffer.alloc(5 + payload.length);
          replacement[0] = 81;
          replacement.writeInt32BE(4 + payload.length, 1);
          payload.copy(replacement, 5);
          commitRollbacks += 1;
          upstream.write(replacement);
          continue;
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
    get commitRollbacks() { return commitRollbacks; },
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

  type NestedScopeOutcome<T> =
    | { status: "fulfilled"; value: T }
    | { status: "rejected"; error: unknown };

  function nestedScopeDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  function observeNestedScope<T>(work: PromiseLike<T>): Promise<NestedScopeOutcome<T>> {
    return Promise.resolve(work).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
  }

  for (const { name, factory } of driverEntries) {
    for (const scopeKind of ["savepoint", "nested-begin"] as const) {
      it(`${name} ${scopeKind} rejects its own callback result after real backend close and recovers its pool`, async () => {
        const observer = direct!;
        const applicationName = `nf_scope_${name.toLowerCase()}_${scopeKind}_${randomUUID().replaceAll("-", "")}`;
        const closed = nestedScopeDeferred<void>();
        const callbackFinished = nestedScopeDeferred<void>();
        const innerObserved = nestedScopeDeferred<NestedScopeOutcome<string>>();
        let closeCount = 0;
        let callbackStarted = false;
        let callbackReturnedAfterClose = false;
        let ownedBackendPid: number | undefined;
        const client = factory(databaseUrl, {
          infer: true, max: 1, prepare: false, connect_timeout: 2, ssl: false,
          connection: { application_name: applicationName },
          onclose() { closeCount += 1; closed.resolve(undefined); },
        });
        const stopOwnedClient = () => client.end({ timeout: 0 });

        try {
          // Healthy control exercises the same nested API before the fault.
          const healthy = await settleOrTerminate(client.begin(async (transaction) => {
            const body = async (nested: TransactionSql) => {
              const [row] = await nested<{ value: number }[]>`select 7::int as value`;
              return row!.value;
            };
            return scopeKind === "savepoint"
              ? transaction.savepoint(body)
              : transaction.begin(body);
          }), 4000, stopOwnedClient);
          expect(healthy).toBe(7);
          expect(closeCount).toBe(0);

          // Capture the outer rejection immediately too, without using it as
          // evidence that the inner savepoint/begin itself rejected.
          const outerObserved = observeNestedScope(client.begin(async (transaction) => {
            const body = async (nested: TransactionSql) => {
              callbackStarted = true;
              try {
                const [owned] = await nested<{
                  pid: number; database: string; application: string;
                }[]>`
                  select pg_backend_pid()::int as pid,
                    current_database()::text as database,
                    current_setting('application_name')::text as application`;
                expect(owned).toBeDefined();
                expect(owned!.database).toBe(databaseName);
                expect(owned!.application).toBe(applicationName);
                expect(Number.isSafeInteger(owned!.pid) && owned!.pid > 0).toBe(true);
                expect(closeCount).toBe(0);
                const targetPid = owned!.pid;
                ownedBackendPid = targetPid;

                // The separate real observer can terminate only this client's
                // PID + database + role + unique application name. The observer
                // PID is excluded. SET LOCAL does not change later observer work.
                const killed = await observer.begin(async (killer) => {
                  await killer`set local statement_timeout = '1000ms'`;
                  return killer<{ terminated: boolean }[]>`
                    select pg_terminate_backend(pid) as terminated
                    from pg_stat_activity
                    where pid = ${targetPid}
                      and pid <> pg_backend_pid()
                      and datname = ${databaseName}
                      and usename = current_user
                      and application_name = ${applicationName}`;
                });
                expect(killed).toHaveLength(1);
                expect(killed[0]?.terminated).toBe(true);

                // An acknowledged pg_terminate_backend is not the close signal.
                // Wait for this driver's real onclose, then deliberately return
                // normally without another nested query masking the regression.
                await settleOrTerminate(closed.promise, 1300, stopOwnedClient);
                expect(closeCount).toBe(1);
                callbackReturnedAfterClose = true;
                return "callback-returned-after-close";
              } finally {
                callbackFinished.resolve(undefined);
              }
            };
            const inner = scopeKind === "savepoint"
              ? transaction.savepoint(body)
              : transaction.begin(body);

            // This is the actual inner Promise outcome. Publishing it separately
            // survives the outer begin's earlier Promise.race(lease.closed) loss.
            void observeNestedScope(inner).then(innerObserved.resolve);
            return await inner;
          }));

          // One existing 1800ms fault budget covers the inner outcome, outer
          // outcome AND callback completion. Expected rejections are values here,
          // so settleOrTerminate does not end the pool on the expected failure.
          const [inner, outer] = await settleOrTerminate(Promise.all([
            innerObserved.promise, outerObserved, callbackFinished.promise,
          ]), 1800, stopOwnedClient);
          expect(callbackStarted).toBe(true);
          expect(callbackReturnedAfterClose).toBe(true);
          expect(inner, "the inner scope must not fulfill its callback's return value").toMatchObject({
            status: "rejected", error: { code: "CONNECTION_CLOSED" },
          });
          expect(outer).toMatchObject({ status: "rejected", error: { code: "CONNECTION_CLOSED" } });

          // Same client/pool, not a newly constructed recovery control.
          const [fresh] = await settleOrTerminate(client<{ value: number; pid: number }[]>`
            select 42::int as value, pg_backend_pid()::int as pid`, 4000, stopOwnedClient);
          expect(fresh?.value).toBe(42);
          expect(fresh?.pid).not.toBe(ownedBackendPid);
          expect(callbackReturnedAfterClose).toBe(true);
        } finally {
          try { await stopOwnedClient(); }
          finally {
            // Even a failed phase must not leave an entered callback unobserved.
            // Its own close wait is bounded; the client is already ended here.
            if (callbackStarted) {
              await settleOrTerminate(callbackFinished.promise, 1300, async () => {});
            }
          }
        }
      }, 12_000);
    }
  }

  for (const { name, factory } of driverEntries) {
    it(`${name} does not turn a healthy leased pool's queue into a cold-start timeout`, async () => {
      const client = factory(databaseUrl, { max: 1, prepare: false, infer: true, connect_timeout: 1, fetch_types: true, ssl: false });
      let reserved: Awaited<ReturnType<Driver["reserve"]>> | undefined;
      let waiting: Promise<unknown> | undefined;
      let settled = false;
      let completed = 0;
      try {
        reserved = await client.reserve();
        waiting = Promise.resolve(client<{ value: number }[]>`select 42::int as value`).then((rows) => {
          completed += 1;
          expect(rows[0]?.value).toBe(42);
        }).finally(() => { settled = true; });
        void waiting.catch(() => {});
        // A real healthy lease has already completed authentication and types.
        // Its queued user query must remain queued beyond connect_timeout.
        await delay(1250);
        expect(settled).toBe(false);
        expect(completed).toBe(0);
        expect((await reserved<{ value: number }[]>`select 1::int as value`)[0]?.value).toBe(1);
        reserved.release(); reserved = undefined;
        await settleOrTerminate(waiting, 2000, () => client.end({ timeout: 0 }));
        expect(completed).toBe(1);
      } finally {
        reserved?.release();
        await client.end({ timeout: 0 });
        if (waiting) await Promise.allSettled([waiting]);
      }
    }, 10_000);

    it(`${name} keeps healthy leased and already-sent SQL alive when an expanding slot receives startup FIN`, async () => {
      const proxy = await createEofProxy(Number(new URL(managed.databaseUrl).port), "forward");
      const url = new URL(databaseUrl); url.port = String(proxy.port);
      const client = factory(url.toString(), { max: 2, prepare: false, infer: true, connect_timeout: 1, fetch_types: true, ssl: false });
      let reserved: Awaited<ReturnType<Driver["reserve"]>> | undefined;
      let queued: Promise<{ status: "fulfilled" } | { status: "rejected"; error: unknown }> | undefined;
      let sentCompletions = 0;
      try {
        reserved = await client.reserve();
        const sent = Promise.resolve(reserved`select pg_sleep(1.2)`).then(() => { sentCompletions += 1; });
        void sent.catch(() => {});
        proxy.setMode("startup-fin");
        queued = Promise.resolve(client`select 2::int`).then(
          () => ({ status: "fulfilled" as const }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        await settleOrTerminate(sent, 2000, () => client.end({ timeout: 0 }));
        expect(sentCompletions).toBe(1);
        expect(proxy.attempts).toBeGreaterThan(1);
        expect((await reserved<{ value: number }[]>`select 3::int as value`)[0]?.value).toBe(3);
        proxy.setMode("forward");
        reserved.release(); reserved = undefined;
        const outcome = await settleOrTerminate(queued, 4000, () => client.end({ timeout: 0 }));
        // An actual failed new transport may reject its own unsent query; it
        // must never cancel or replay the unrelated healthy lease's SQL.
        if (outcome.status === "rejected") expect(outcome.error).toMatchObject({ code: "CONNECTION_CLOSED" });
        const fresh = await settleOrTerminate(client<{ value: number }[]>`select 4::int as value`, 4000,
          () => client.end({ timeout: 0 }));
        expect(fresh[0]?.value).toBe(4);
        expect(sentCompletions).toBe(1);
      } finally {
        reserved?.release();
        await client.end({ timeout: 0 });
        if (queued) await Promise.allSettled([queued]);
        await proxy.close();
      }
    }, 12_000);
  }

  for (const { name, factory } of driverEntries) {
    it(`${name} rejects a real server ROLLBACK response at COMMIT without reporting or retaining a write`, async () => {
      const observer = direct!;
      const table = `postgres_v4_commit_${randomUUID().replaceAll("-", "")}`;
      await observer`create table ${observer(table)} (id integer primary key)`;
      const proxy = await createEofProxy(Number(new URL(managed.databaseUrl).port), "commit-rollback");
      const url = new URL(databaseUrl); url.port = String(proxy.port);
      const client = factory(url.toString(), { infer: true, max: 1, prepare: false, connect_timeout: 2, ssl: false });
      try {
        await expect(client.begin(async (transaction) => {
          await transaction`insert into ${transaction(table)} values (1)`;
        })).rejects.toMatchObject({ code: "TRANSACTION_ROLLED_BACK" });
        expect(proxy.commitRollbacks).toBe(1);
        expect(await observer`select id from ${observer(table)}`).toHaveLength(0);
      } finally {
        try { await client.end({ timeout: 0 }); }
        finally { try { await proxy.close(); } finally { await observer`drop table ${observer(table)}`; } }
      }
    });

    it(`${name} keeps explicit casts and v3-compatible inference across timezone, arrays, JSON and Drizzle`, async () => {
      const client = factory(databaseUrl, { max: 1, prepare: false, connect_timeout: 2, ssl: false,
        connection: { TimeZone: "Asia/Shanghai" } });
      const compatible = factory(databaseUrl, { infer: true, max: 1, prepare: false, connect_timeout: 2, ssl: false,
        connection: { TimeZone: "Asia/Shanghai" } });
      try {
        expect(client.options.infer).toBe(false);
        const [untyped] = await client<{ value: string }[]>`select ${true} as value`;
        expect(untyped?.value).toBe("true");
        const instant = new Date("2026-10-31T16:30:00.000Z");
        const [cast] = await client<{ flag: boolean; values: number[]; payload: { nested: string[] }; instant: Date; local_date: string }[]>`
          select ${true}::boolean as flag, ${[1, 2, 3]}::integer[] as values,
            ${client.json({ nested: ["synthetic", "中文"] })}::jsonb as payload,
            ${instant}::timestamptz as instant, (${instant}::timestamptz)::date::text as local_date`;
        expect(cast).toEqual({ flag: true, values: [1, 2, 3], payload: { nested: ["synthetic", "中文"] },
          instant, local_date: "2026-11-01" });
        const [legacy] = await compatible<{ flag: boolean; instant: Date }[]>`select ${true} as flag, ${instant} as instant`;
        expect(legacy).toEqual({ flag: true, instant });
        const orm = drizzle(compatible);
        const rows = await orm.execute<{ flag: boolean; values: number[]; payload: { count: number }; instant: string }>(drizzleSql`
          select ${true}::boolean as flag, array[${2}, ${4}]::integer[] as values,
            ${JSON.stringify({ count: 2 })}::jsonb as payload, ${instant.toISOString()}::timestamptz as instant`);
        expect(rows[0]).toMatchObject({ flag: true, values: [2, 4], payload: { count: 2 } });
        expect(new Date(rows[0]!.instant).toISOString()).toBe(instant.toISOString());
      } finally {
        await Promise.all([client.end({ timeout: 0 }), compatible.end({ timeout: 0 })]);
      }
    });

    it(`${name} rejects released leases and rolls back caught server errors, while Drizzle nested transactions remain isolated`, async () => {
      const client = factory(databaseUrl, { infer: true, max: 1, prepare: false, connect_timeout: 2, ssl: false });
      try {
        const reserved = await client.reserve();
        await reserved`select 1`;
        reserved.release();
        await expect(Promise.resolve(reserved`select 1`)).rejects.toMatchObject({ code: "UNSAFE_TRANSACTION" });
        let completedTransaction: TransactionSql | undefined;
        await client.begin(async (transaction) => { completedTransaction = transaction; await transaction`select 1`; });
        await expect(Promise.resolve(completedTransaction!`select 1`)).rejects.toMatchObject({ code: "UNSAFE_TRANSACTION" });
        await client`create temporary table postgres_v4_rollback (id integer primary key)`;
        await expect(client.begin(async (transaction) => {
          await transaction`insert into postgres_v4_rollback values (1)`;
          // Catching a server error must not turn an aborted transaction into a
          // reported commit. v4 rejects the scope and rolls back its first write.
          await transaction`select 1 / 0`.catch(() => undefined);
        })).rejects.toMatchObject({ code: "22012" });
        expect(await client`select id from postgres_v4_rollback`).toHaveLength(0);
        const orm = drizzle(client);
        await orm.transaction(async (transaction) => {
          await transaction.execute(drizzleSql`create temporary table postgres_v4_scope (id integer primary key) on commit drop`);
          await transaction.execute(drizzleSql`insert into postgres_v4_scope values (1)`);
          await expect(transaction.transaction(async (nested) => {
            await nested.execute(drizzleSql`insert into postgres_v4_scope values (2)`);
            throw new Error("SYNTHETIC_NESTED_ROLLBACK");
          })).rejects.toThrow("SYNTHETIC_NESTED_ROLLBACK");
          const rows = await transaction.execute<{ id: number }>(drizzleSql`select id from postgres_v4_scope order by id`);
          expect(Array.from(rows)).toEqual([{ id: 1 }]);
        });
        expect((await client<{ value: number }[]>`select 1 as value`)[0]?.value).toBe(1);
      } finally { await client.end({ timeout: 0 }); }
    });

    for (const mode of ["startup-fin", "array-types-fin", "array-types-hang"] as const) {
      it.each(["query", "reserve", "begin", "drizzle-transaction"] as const)(
        `${name} ${mode} rejects five cold %s with two pool slots and recovers without late callbacks`,
        async (operation) => {
          const proxy = await createEofProxy(Number(new URL(managed.databaseUrl).port), mode);
          const url = new URL(databaseUrl);
          url.port = String(proxy.port);
          const client = factory(url.toString(), { infer: true, max: 2, prepare: false, connect_timeout: 1, fetch_types: true, ssl: false });
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
              if (failure.status === "rejected") expect(failure.reason).toMatchObject({ code: mode === "array-types-hang" ? "CONNECT_TIMEOUT" : "CONNECTION_CLOSED" });
            }
            expect(businessCalls).toBe(0);
            if (mode !== "startup-fin") expect(proxy.arrayTypeCuts).toBeGreaterThan(0);
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
      expect(typeof postgresCjs).toBe("function");
      expect(cjsRequire.resolve("postgres").replace(/\\/gu, "/")).toMatch(/\/postgres\/src\/index\.js$/u);
      const proxy = await createEofProxy(Number(new URL(managed.databaseUrl).port), "forward");
      const url = new URL(databaseUrl);
      url.port = String(proxy.port);
      const client = factory(url.toString(), { infer: true, max: 2, prepare: false, connect_timeout: 1, fetch_types: true, ssl: false });
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
