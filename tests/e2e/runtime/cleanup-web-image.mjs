import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const report = path.join(root, "test-results/web-readiness-image.json");
const manifest = JSON.parse(await readFile(report, "utf8"));
assert.match(manifest.runId, /^[a-f0-9]{32}$/u);
assert.equal(manifest.name, "unfreq-web-browser-" + manifest.runId);
assert.match(manifest.imageId, /^sha256:[a-f0-9]{64}$/u);
const imageFile = process.env.WEB_IMAGE_ID_FILE ?? "test-results/web-readiness-image.id";
assert.equal(manifest.imageId, (await readFile(path.resolve(root, imageFile), "utf8")).trim());
if (process.env.EXPECTED_WEB_REVISION !== undefined) {
  assert.equal(manifest.sourceRevision, process.env.EXPECTED_WEB_REVISION);
}
const exec = promisify(execFile);
const docker = (...args) => exec("docker", args, { timeout: 30_000, maxBuffer: 1_048_576 });
const filter = "label=unfreq.test.run=" + manifest.runId;
const ids = (await docker("ps", "--all", "--quiet", "--filter", filter)).stdout.trim().split(/\s+/u).filter(Boolean);
for (const id of ids) {
  const owned = JSON.parse((await docker("inspect", id)).stdout)[0];
  assert.equal(owned.Config.Labels["unfreq.test.run"], manifest.runId);
  assert.equal(owned.Image, manifest.imageId);
  assert.equal(owned.Name, "/" + manifest.name);
  await docker("stop", "--time", "10", id);
  await docker("rm", id);
}
assert.equal((await docker("ps", "--all", "--quiet", "--filter", filter)).stdout.trim(), "",
  "The exact browser run must have no remaining container.");
manifest.cleaned = true;
manifest.cleanupVerifiedAt = new Date().toISOString();
manifest.cleanupVerifier = "independent-docker-readback";
await writeFile(report, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ imageId: manifest.imageId, cleaned: true, remainingOwnedContainers: 0 }));
