import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const runId = process.env.UNFREQ_WEB_IMAGE_RUN_ID ?? "";
assert.match(runId, /^[a-f0-9]{24}$/);
assert.equal(process.platform, "linux");
assert.equal(process.cwd(), "/app");
const children = [];
let closing = false;
let failed = false;
function start(command, args, env) {
  const child = spawn(command, args, { cwd: "/app", env, stdio: "inherit", detached: true });
  children.push(child);
  child.once("error", () => { failed = true; void close(); });
  child.once("exit", () => { if (!closing) { failed = true; void close(); } });
  return child;
}
const commonEnv = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  API_INTERNAL_BASE_URL: "http://127.0.0.1:4200", NEXT_PUBLIC_API_BASE_URL: "/api", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
start(process.execPath, ["/fixtures/runtime/mock-api.mjs"], { ...commonEnv, RUNTIME_API_PORT: "4200" });
// Exactly the runner image's declared command; the test supervisor adds only
// a process-local synthetic API and reverse proxy around the actual server.
start("npm", ["--workspace", "@unfreq/web", "run", "start"], {
  ...commonEnv, NODE_OPTIONS: "--import /fixtures/web-fetch-guard.mjs",
});

const server = createServer(async (incoming, outgoing) => {
  const pathname = (incoming.url ?? "/").split("?")[0];
  if (pathname === "/__image/identity") {
    let blockedFetch = 0;
    try { blockedFetch = (await readFile("/tmp/unfreq-web-image-blocked-fetch", "utf8")).trim().split("\n").filter(Boolean).length; }
    catch (error) { if (error.code !== "ENOENT") { outgoing.writeHead(500); outgoing.end(); return; } }
    outgoing.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    outgoing.end(JSON.stringify({ runId, syntheticOnly: true, blockedFetch }));
    return;
  }
  if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) { outgoing.writeHead(400); outgoing.end(); return; }
  const toApi = pathname.startsWith("/__runtime/") ||
    (pathname.startsWith("/api/") && !pathname.startsWith("/api/og/")) || pathname.startsWith("/health");
  const proxy = request({ hostname: "127.0.0.1", port: toApi ? 4200 : 3000, method: incoming.method,
    path: incoming.url, headers: incoming.headers }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  proxy.once("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
  incoming.once("aborted", () => proxy.destroy());
  incoming.pipe(proxy);
});
server.listen(8080, "0.0.0.0");

let closePromise;
function close() {
  closePromise ??= (async () => {
    closing = true;
    server.close();
    server.closeAllConnections();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    const remaining = children.filter((child) => child.exitCode === null && child.signalCode === null);
    await Promise.all(remaining.map((child) => new Promise((resolve) => child.once("exit", resolve))));
    process.exitCode = failed ? 1 : 0;
  })();
  return closePromise;
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void close(); });
