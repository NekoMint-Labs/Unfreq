import { defineConfig, devices } from "playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// This config never starts or reuses a local Next server. Only its owning
// image verifier may supply a loopback port and matching temporary manifest.
const runId = process.env.UNFREQ_WEB_IMAGE_RUN_ID ?? "";
const manifestPath = process.env.UNFREQ_WEB_IMAGE_MANIFEST ?? "";
const root = path.resolve("test-results", "web-image");
const resolved = path.resolve(manifestPath);
if (!/^[a-f0-9]{24}$/.test(runId) || path.basename(resolved) !== "manifest.json" ||
    path.dirname(path.dirname(resolved)) !== root || !path.basename(path.dirname(resolved)).startsWith(`run-${runId}-`)) {
  throw new Error("Production image browsers require their managed test manifest.");
}
const manifest = JSON.parse(readFileSync(resolved, "utf8"));
const port = Number(manifest.port);
if (manifest.runId !== runId || manifest.ownerPid !== Number(process.env.UNFREQ_WEB_IMAGE_OWNER_PID) ||
    manifest.token !== process.env.UNFREQ_WEB_IMAGE_TOKEN || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Production image ownership or endpoint mismatch.");
}
process.env.RUNTIME_API_PORT = String(port);
process.env.RUNTIME_WEB_PORT = String(port);
export default defineConfig({
  expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, timeout: 60_000,
  testDir: "tests/e2e/runtime", testMatch: ["production.spec.ts", "image-only.spec.ts"],
  outputDir: path.join(path.dirname(resolved), "browser"),
  reporter: [["list"], ["json", { outputFile: path.join(path.dirname(resolved), "playwright.json") }]],
  projects: [{ name: "chromium-linux-image", use: { ...devices["Desktop Chrome"] } }],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
});
