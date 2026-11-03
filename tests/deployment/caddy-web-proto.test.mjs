import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docker = (...args) => exec("docker", args, { timeout: 90_000, maxBuffer: 1_048_576 });

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
function upstream(name) {
  return createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ upstream: name, path: request.url,
      proto: request.headers["x-forwarded-proto"] }));
  });
}

test("Caddy routes Web requests with the server HTTPS policy and preserves API routing", { timeout: 120_000 }, async () => {
  assert.equal(process.platform, "linux", "This regression requires a disposable Linux Docker runner.");
  const source = await readFile(path.join(root, "deploy/Caddyfile"), "utf8");
  const compose = await readFile(path.join(root, "compose.yaml"), "utf8");
  const image = compose.match(/image:\s*(caddy:[^\s]+)/u)?.[1];
  assert.ok(image, "Use the repository's Caddy image.");
  assert.ok(source.startsWith(":80 {"), "Only the test listener may be changed.");
  const reservation = createServer();
  const proxyPort = await listen(reservation, 0);
  await close(reservation);
  const directory = await mkdtemp(path.join(tmpdir(), "unfreq-web-proto-"));
  const container = "unfreq-web-proto-" + randomUUID().replaceAll("-", "");
  const web = upstream("web");
  const api = upstream("api");
  const results = [];
  let attemptedContainer = false;
  try {
    await listen(web, 3000);
    await listen(api, 4000);
    const config = path.join(directory, "Caddyfile");
    await writeFile(config, source.replace(":80 {", ":" + proxyPort + " {"));
    attemptedContainer = true;
    await docker("run", "--detach", "--name", container,
      "--label", "unfreq.test=web-readiness", "--network", "host",
      "--add-host", "web:127.0.0.1", "--add-host", "api:127.0.0.1",
      "--read-only", "--tmpfs", "/config", "--tmpfs", "/data",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--mount", "type=bind,src=" + config + ",dst=/etc/caddy/Caddyfile,readonly",
      image);
    const base = "http://127.0.0.1:" + proxyPort;
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        const response = await fetch(base + "/web-health", { signal: AbortSignal.timeout(1000) });
        if (response.ok) break;
      } catch {}
      assert.ok(Date.now() < deadline, "Caddy must start within 15 seconds.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const route of ["/", "/result/synthetic", "/api/og/synthetic", "/web-health", "/api/synthetic", "/health"]) {
      const response = await fetch(base + route, {
        headers: { "x-forwarded-proto": "http", "x-forwarded-host": "attacker.invalid" },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200, route);
      const body = await response.json();
      const webRoute = !["/api/synthetic", "/health"].includes(route);
      assert.deepEqual(body, { upstream: webRoute ? "web" : "api", path: route,
        proto: webRoute ? "https" : "http" }, route);
      results.push({ route, ...body });
    }
    const imageId = (await docker("image", "inspect", "--format", "{{.Id}}", image)).stdout.trim();
    await mkdir(path.join(root, "test-results"), { recursive: true });
    await writeFile(path.join(root, "test-results/web-readiness-caddy.json"), JSON.stringify({
      sourceSha256: createHash("sha256").update(source).digest("hex"), image, imageId, results,
    }, null, 2));
    console.log(JSON.stringify({ routes: results.length, imageId }));
  } finally {
    const cleanup = await Promise.allSettled([
      attemptedContainer ? docker("rm", "--force", container).catch((error) => {
        if (!String(error.stderr).includes("No such container")) throw error;
      }) : Promise.resolve(),
      close(web), close(api),
    ]);
    await rm(directory, { recursive: true });
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  }
});
