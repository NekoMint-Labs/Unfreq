import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import postgres from "postgres";

// Upstream diagnostic, deliberately outside Vitest's default acceptance suite.
// It only contacts the FIN endpoint that this process creates on loopback.
// Exit 1 means the startup query is still pending: this is not a passing test.
const observationWindowMs = 1300;
const connectTimeoutSeconds = 1;

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
    ? error.code
    : "UNKNOWN";
}

async function main() {
  const lock = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.resolve("postgres")), "utf8"));
  const lockedVersion = lock.packages?.["node_modules/postgres"]?.version;
  if (manifest.name !== "postgres" || lockedVersion === undefined || manifest.version !== lockedVersion) {
    throw new Error("The diagnostic requires the installed, locked postgres package.");
  }

  let connectionAttempts = 0;
  const sockets = new Set();
  const server = createServer((socket) => {
    connectionAttempts += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", () => {});
    socket.end(); // Explicit TCP FIN, not resetAndDestroy()/RST.
  });
  let sql;
  let observationTimer;
  let outcome;
  let cleanupOutcome;
  let observedMs;
  let clientClosed = false;
  let serverClosed = false;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Owned TCP endpoint did not start.");
    sql = postgres(`postgres://synthetic:synthetic@127.0.0.1:${address.port}/synthetic`, {
      max: 1,
      prepare: false,
      connect_timeout: connectTimeoutSeconds,
    });
    const start = performance.now();
    const queryOutcome = sql`select 1`.then(
      () => ({ state: "resolved" }),
      (error) => ({ state: "rejected", code: safeErrorCode(error) }),
    );
    outcome = await Promise.race([
      queryOutcome,
      new Promise((resolve) => {
        observationTimer = setTimeout(() => resolve({ state: "pending" }), observationWindowMs);
      }),
    ]);
    observedMs = Math.round(performance.now() - start);
    clearTimeout(observationTimer);
    await sql.end({ timeout: 0.1 });
    clientClosed = true;
    cleanupOutcome = await queryOutcome;
  } finally {
    clearTimeout(observationTimer);
    try {
      if (sql !== undefined && !clientClosed) {
        await sql.end({ timeout: 0.1 });
        clientClosed = true;
      }
    } finally {
      const closing = server.listening
        ? new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
        : Promise.resolve();
      await Promise.all([...sockets].map((socket) => new Promise((resolve) => {
        if (socket.closed) resolve();
        else socket.once("close", resolve);
        socket.destroy();
      })));
      await closing;
      serverClosed = !server.listening;
    }
  }

  const status = outcome.state === "pending" ? "not-fixed" : outcome.state === "rejected" ? "settled-in-observation" : "inconclusive";
  console.log(JSON.stringify({
    diagnostic: "postgres-startup-eof",
    status,
    nodeVersion: process.version,
    postgresVersion: manifest.version,
    fixture: "owned-loopback-TCP-FIN",
    connectTimeoutSeconds,
    observationWindowMs,
    observedMs,
    connectionAttempts,
    outcome,
    cleanupOutcome,
    cleanup: { clientClosed, serverClosed, ownedSocketsRemaining: sockets.size },
    acceptancePassed: false,
  }));
  process.exitCode = outcome.state === "pending" ? 1 : outcome.state === "rejected" ? 0 : 2;
}

main().catch((error) => {
  console.log(JSON.stringify({ diagnostic: "postgres-startup-eof", status: "diagnostic-error", code: safeErrorCode(error), acceptancePassed: false }));
  process.exitCode = 2;
});
