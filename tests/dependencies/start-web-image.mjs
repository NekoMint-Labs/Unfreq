import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "linux", "Web image acceptance requires a disposable Linux Docker runner.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exec = promisify(execFile);
const run = (...args) => exec("docker", args, { timeout: 30_000, maxBuffer: 1_048_576 });
const imageFile = process.env.WEB_IMAGE_ID_FILE ?? "test-results/high-dependency-web-image.id";
const imageId = (await readFile(path.resolve(root, imageFile), "utf8")).trim();
assert.match(imageId, /^sha256:[a-f0-9]{64}$/u, "Use a built immutable image ID.");
const image = JSON.parse((await run("image", "inspect", imageId)).stdout)[0];
assert.equal(image.Id, imageId);
if (process.env.EXPECTED_WEB_REVISION !== undefined) {
  assert.equal(image.Config.Labels["org.opencontainers.image.revision"], process.env.EXPECTED_WEB_REVISION);
}
const runId = randomUUID().replaceAll("-", "");
const name = "unfreq-web-browser-" + runId;
const webPort = Number(process.env.RUNTIME_WEB_PORT ?? 3200);
const apiPort = Number(process.env.RUNTIME_API_PORT ?? 4200);
assert.ok(Number.isInteger(webPort) && webPort >= 1024 && webPort <= 65535);
assert.ok(Number.isInteger(apiPort) && apiPort >= 1024 && apiPort <= 65535 && apiPort !== webPort);
const manifest = {
  imageId, imageCreatedAt: image.Created,
  sourceRevision: image.Config.Labels?.["org.opencontainers.image.revision"],
  checkout: (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(),
  runId, name, startedAt: new Date().toISOString(), cleaned: false,
};
await mkdir(path.join(root, "test-results"), { recursive: true });
const report = path.join(root, "test-results/high-dependency-web-image.json");
await writeFile(report, JSON.stringify(manifest, null, 2));
let stopping;
let stopError;
async function stop() {
  try {
    const containers = (await run("ps", "--all", "--quiet", "--filter", "label=unfreq.test.run=" + runId)).stdout.trim().split(/\s+/u).filter(Boolean);
    for (const id of containers) {
      const owned = JSON.parse((await run("inspect", id)).stdout)[0];
      assert.equal(owned.Config.Labels["unfreq.test.run"], runId);
      assert.equal(owned.Image, imageId);
      assert.equal(owned.Name, "/" + name);
      await run("stop", "--time", "10", id);
      await run("rm", id);
    }
    const remaining = (await run("ps", "--all", "--quiet", "--filter", "label=unfreq.test.run=" + runId)).stdout.trim();
    assert.equal(remaining, "", "The owned Web container must be removed.");
    manifest.cleaned = true;
  } catch (error) {
    stopError = error;
    manifest.cleanupError = error.message;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeFile(report, JSON.stringify(manifest, null, 2));
  }
}
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => { stopping ??= stop(); });
}
const child = spawn("docker", ["run", "--init", "--sig-proxy=false",
  "--name", name, "--label", "unfreq.test.run=" + runId, "--network", "host",
  "--env", "PORT=" + webPort, "--env", "API_INTERNAL_BASE_URL=http://127.0.0.1:" + apiPort,
  "--env", "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:" + apiPort,
  imageId], { cwd: root, windowsHide: true, stdio: "inherit" });
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
if (stopping !== undefined) {
  await stopping;
  if (stopError !== undefined) throw stopError;
} else {
  stopping = stop();
  await stopping;
  throw new Error("The Web image exited before the test runner stopped it: " + JSON.stringify(result));
}
