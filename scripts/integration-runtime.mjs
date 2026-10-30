import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This module imports no application/configuration/ALS code. The same source
// runs in the coordinator and is emitted by tsc into the child's runtime tree.
export const runtimeEntryRelative = "apps/api/tests/integration/generation-process-fixture.js";
export const runtimeEntryRelatives = Object.freeze({ generation: runtimeEntryRelative,
  abuse: "apps/api/tests/integration/abuse-process-fixture.js" });
const criticalSourceModules = ["config/env", "config/abuse", "shared/abuse-control", "shared/abuse-errors",
  "shared/request-identity", "modules/auth/service", "modules/auth/routes", "modules/auth/identity",
  "modules/ai/service", "modules/ai/repository", "modules/ai/provider-execution", "modules/ai/embedding-space", "modules/signals/service-embedding", "modules/ai/provider-config", "modules/ai/provider-transport", "modules/ai/provider-health", "modules/ai/embedding", "modules/ai/reranker", "modules/ai/tts",
  "modules/signals/service-creation", "modules/frontend-diagnostics/routes", "db/schema",
  "modules/signals/service-queries", "modules/signals/service-matching", "modules/signals/service-interactions",
  "modules/signals/service-publication-confirmation", "modules/signals/service-withdrawal", "modules/signals/service-publishing",
  "modules/signals/publication-policy", "modules/signals/galaxy-sampling", "modules/signals/history-cursor", "modules/monthly-recaps/repository", "modules/signals/repository", "modules/signals/publication-repository", "modules/signals/publication", "modules/signals/schemas", "modules/signals/audio-repository", "modules/signals/audio-worker",
  "modules/signals/service-audio", "modules/signals/routes", "modules/signals/audio-storage", "modules/signals/service-mappers",
  "shared/shutdown-budget", "shared/log-redaction", "server"];
export const runtimeArtifactPaths = Object.freeze([
  "package.json", "scripts/integration-runtime.mjs", runtimeEntryRelative,
  runtimeEntryRelatives.abuse,
  "apps/api/tests/integration/generation-test-controls.js",
  "apps/api/tests/integration/fixtures.js", "apps/api/src/app.js",
  "apps/api/src/shared/generation-execution.js",
  "apps/api/src/modules/signals/generation-worker.js",
  ...criticalSourceModules.map((name) => `apps/api/src/${name}.js`),
]);
export const runtimeSourcePaths = Object.freeze([
  "apps/api/tsconfig.json", "apps/api/tsconfig.integration-runtime.json",
  "apps/api/tests/integration/generation-process-fixture.ts",
  "apps/api/tests/integration/generation-test-controls.ts",
  "apps/api/tests/integration/fixtures.ts", "apps/api/src/app.ts",
  "apps/api/tests/integration/harness.ts",
  "apps/api/src/shared/generation-execution.ts",
  "apps/api/src/modules/signals/generation-worker.ts",
  "scripts/integration-runtime.mjs",
  "apps/api/tests/integration/abuse-process-fixture.ts",
  ...criticalSourceModules.map((name) => `apps/api/src/${name}.ts`),
]);
const sourcePaths = runtimeSourcePaths;
const samePath = (left, right) => process.platform === "win32"
  ? left.toLowerCase() === right.toLowerCase() : left === right;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = () => { throw new Error("Managed integration runtime ownership or artifact verification failed."); };

async function ordinaryFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) fail();
  if (!samePath(await realpath(filename), path.resolve(filename))) fail();
  return readFile(filename);
}

async function ownedRun(repositoryRoot, runDirectory) {
  if (typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot) ||
      typeof runDirectory !== "string" || !path.isAbsolute(runDirectory)) fail();
  const root = await realpath(repositoryRoot);
  const run = path.resolve(runDirectory);
  const parent = path.join(root, "test-results", "integration");
  if (!samePath(path.dirname(run), parent) || !/^run-[A-Za-z0-9]{6}$/u.test(path.basename(run))) fail();
  const info = await lstat(run);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(run), run)) fail();
  return { root, run };
}

async function hashes(root, paths) {
  const entries = await Promise.all(paths.map(async (relative) => [relative, sha256(await ordinaryFile(path.join(root, relative)))]));
  return Object.fromEntries(entries);
}

function equalHashes(actual, expected, names) {
  if (typeof expected !== "object" || expected === null || Array.isArray(expected) ||
      Object.keys(expected).length !== names.length) fail();
  for (const name of names) if (!/^[a-f0-9]{64}$/u.test(expected[name]) || expected[name] !== actual[name]) fail();
}

export async function prepareIntegrationRuntime({ repositoryRoot, runDirectory, runId, compile }) {
  if (!/^[a-f0-9]{12}$/u.test(runId) || typeof compile !== "function") fail();
  const { root, run } = await ownedRun(repositoryRoot, runDirectory);
  const runtimeDirectory = path.join(run, "runtime");
  // Never adopt an old directory, shared dist output or a partial prior build.
  await mkdir(runtimeDirectory);
  const inputs = await hashes(root, sourcePaths);
  await writeFile(path.join(runtimeDirectory, "package.json"), '{"type":"module"}\n', { flag: "wx" });
  await compile(runtimeDirectory);
  equalHashes(await hashes(root, sourcePaths), inputs, sourcePaths);
  const files = await hashes(runtimeDirectory, runtimeArtifactPaths);
  const ownershipToken = randomBytes(32).toString("hex");
  const marker = {
    version: 1, runId, ownerPid: process.pid, sourceRoot: root,
    runtimeDirectory, entryRelative: runtimeEntryRelative, entryRelatives: runtimeEntryRelatives, ownershipToken, files, inputs,
  };
  await writeFile(path.join(run, "runtime-marker.json"), `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
  return verifyIntegrationRuntime({ repositoryRoot: root, runId, runtimeDirectory, ownershipToken });
}

export async function verifyIntegrationRuntime({ repositoryRoot, runId, runtimeDirectory, ownershipToken, executingEntry, entry = "generation" }) {
  if (!Object.hasOwn(runtimeEntryRelatives, entry)) fail();
  if (typeof runtimeDirectory !== "string" || !path.isAbsolute(runtimeDirectory) ||
      !/^[a-f0-9]{12}$/u.test(runId) || !/^[a-f0-9]{64}$/u.test(ownershipToken)) fail();
  const directory = path.resolve(runtimeDirectory);
  if (path.basename(directory) !== "runtime") fail();
  const runDirectory = path.dirname(directory);
  // The child derives the source root only from the fixed owned suffix, never
  // from this module's different source/emitted import.meta location.
  const derivedRoot = path.dirname(path.dirname(path.dirname(runDirectory)));
  const { root, run } = await ownedRun(repositoryRoot ?? derivedRoot, runDirectory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(directory), directory)) fail();
  const markerBytes = await ordinaryFile(path.join(run, "runtime-marker.json"));
  if (markerBytes.byteLength > 32_768) fail();
  const marker = JSON.parse(markerBytes.toString("utf8"));
  if (!marker || marker.version !== 1 || marker.runId !== runId ||
      marker.ownershipToken !== ownershipToken || !Number.isSafeInteger(marker.ownerPid) || marker.ownerPid <= 0 ||
      !samePath(marker.sourceRoot, root) || !samePath(marker.runtimeDirectory, directory) ||
      marker.entryRelative !== runtimeEntryRelative || !marker.entryRelatives ||
      Object.keys(marker.entryRelatives).length !== 2 ||
      Object.entries(runtimeEntryRelatives).some(([name, value]) => marker.entryRelatives[name] !== value)) fail();
  const files = await hashes(directory, runtimeArtifactPaths);
  equalHashes(files, marker.files, runtimeArtifactPaths);
  equalHashes(await hashes(root, sourcePaths), marker.inputs, sourcePaths);
  const packageData = JSON.parse((await ordinaryFile(path.join(directory, "package.json"))).toString("utf8"));
  if (packageData.type !== "module") fail();
  const entryRelative = runtimeEntryRelatives[entry];
  const entryPath = path.join(directory, entryRelative);
  if (executingEntry !== undefined) {
    if (!samePath(path.resolve(executingEntry), entryPath) ||
        !samePath(fileURLToPath(import.meta.url), path.join(directory, "scripts", "integration-runtime.mjs")) ||
        process.execArgv.length !== 0) fail();
  }
  return { runId, runDirectory: run, runtimeDirectory: directory, ownershipToken,
    entryPath, entrySha256: files[entryRelative] };
}
