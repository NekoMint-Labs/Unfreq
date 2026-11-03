import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareIntegrationRuntime, runtimeArtifactPaths, runtimeEntryRelative, runtimeEntryRelatives, runtimeSourcePaths, verifyIntegrationRuntime } from "../../scripts/integration-runtime.mjs";

const actualGuard = await readFile(new URL("../../scripts/integration-runtime.mjs", import.meta.url));
const runId = "012345abcdef";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "unfreq-runtime-guard-"));
  // This owns only its newly created synthetic directory, never the checkout.
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceFiles = runtimeSourcePaths;
  for (const name of sourceFiles) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), "// synthetic compile input\n");
  }
  const parent = path.join(root, "test-results", "integration");
  await mkdir(parent, { recursive: true });
  const runDirectory = await mkdtemp(path.join(parent, "run-"));
  const compile = async (output) => {
    for (const name of runtimeArtifactPaths.filter((value) => value !== "package.json")) {
      await mkdir(path.dirname(path.join(output, name)), { recursive: true });
      await writeFile(path.join(output, name), name === "scripts/integration-runtime.mjs" ? actualGuard : "export {};\n");
    }
    // A tiny harmless Node entry exercises the actual emitted guard identity,
    // with no API/env/DB imports, credentials or service connections.
    for (const [entry, relative] of Object.entries(runtimeEntryRelatives)) await writeFile(path.join(output, relative), `
import { fileURLToPath } from "node:url";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";
await verifyIntegrationRuntime({runId:process.env.RUNTIME_RUN, runtimeDirectory:process.env.RUNTIME_DIR,
  ownershipToken:process.env.RUNTIME_TOKEN, executingEntry:fileURLToPath(import.meta.url),entry:${JSON.stringify(entry)}});
console.log("owned-runtime-verified");
`);
  };
  const prepare = (override = compile) => prepareIntegrationRuntime({ repositoryRoot: root, runDirectory, runId, compile: override });
  return { root, runDirectory, prepare };
}

test("an owned compiled ESM entry validates in a fresh plain Node PID", async (t) => {
  const f = await fixture(t);
  const runtime = await f.prepare();
  assert.equal(runtime.entryPath, path.join(f.runDirectory, "runtime", runtimeEntryRelative));
  assert.match(runtime.entrySha256, /^[a-f0-9]{64}$/u);
  const result = spawnSync(process.execPath, [runtime.entryPath], { windowsHide: true, encoding: "utf8", timeout: 5_000,
    env: { RUNTIME_RUN: runId, RUNTIME_DIR: runtime.runtimeDirectory, RUNTIME_TOKEN: runtime.ownershipToken,
      ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "owned-runtime-verified");
  const abuse = await verifyIntegrationRuntime({ repositoryRoot: f.root, ...runtime, entry: "abuse" });
  const second = spawnSync(process.execPath, [abuse.entryPath], { windowsHide: true, encoding: "utf8", timeout: 5_000,
    env: { RUNTIME_RUN: runId, RUNTIME_DIR: runtime.runtimeDirectory, RUNTIME_TOKEN: runtime.ownershipToken,
      ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) } });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout.trim(), "owned-runtime-verified");
  await assert.rejects(verifyIntegrationRuntime({ repositoryRoot: f.root, ...runtime, entry: "arbitrary" }));
});

test("foreign run, token and output paths are refused before use", async (t) => {
  const f = await fixture(t);
  const runtime = await f.prepare();
  for (const changes of [
    { runId: "abcdef012345" }, { ownershipToken: "a".repeat(64) },
    { runtimeDirectory: path.join(f.root, "dist") }, { repositoryRoot: path.join(f.root, "apps") },
  ]) await assert.rejects(verifyIntegrationRuntime({ repositoryRoot: f.root, ...runtime, ...changes }));
});

test("changed entry, current input and ownership marker cannot be adopted", async (t) => {
  const f = await fixture(t);
  const runtime = await f.prepare();
  const check = () => verifyIntegrationRuntime({ repositoryRoot: f.root, ...runtime });
  const original = await readFile(runtime.entryPath);
  await writeFile(runtime.entryPath, "export const unexpected = true;\n");
  await assert.rejects(check());
  await writeFile(runtime.entryPath, original);
  const source = path.join(f.root, "apps/api/src/app.ts");
  await writeFile(source, "// changed after compilation\n");
  await assert.rejects(check());
  await writeFile(source, "// synthetic compile input\n");
  const markerPath = path.join(f.runDirectory, "runtime-marker.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  marker.sourceRoot = path.join(f.root, "other");
  await writeFile(markerPath, JSON.stringify(marker));
  await assert.rejects(check());
});

test("a source helper cannot vouch for a compiled executing entry or reuse output", async (t) => {
  const f = await fixture(t);
  const runtime = await f.prepare();
  await assert.rejects(verifyIntegrationRuntime({ repositoryRoot: f.root, ...runtime,
    executingEntry: fileURLToPath(new URL("../../apps/api/tests/integration/generation-process-fixture.ts", import.meta.url)) }));
  await assert.rejects(f.prepare());
});

test("failed compilation leaves no publishable marker and never falls back", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  await assert.rejects(f.prepare(async () => { calls += 1; throw new Error("SYNTHETIC_COMPILE_FAILURE"); }), /SYNTHETIC_COMPILE_FAILURE/u);
  assert.equal(calls, 1);
  await assert.rejects(readFile(path.join(f.runDirectory, "runtime-marker.json")));
  await assert.rejects(verifyIntegrationRuntime({ repositoryRoot: f.root, runId,
    runtimeDirectory: path.join(f.runDirectory, "runtime"), ownershipToken: "a".repeat(64) }));
});

test("a compiler changing an input cannot publish its output", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.prepare(async () => {
    await writeFile(path.join(f.root, "apps/api/src/shared/generation-execution.ts"), "// concurrent edit\n");
  }));
  await assert.rejects(readFile(path.join(f.runDirectory, "runtime-marker.json")));
});
