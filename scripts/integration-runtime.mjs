import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This module imports no application/configuration/ALS code. The same source
// runs in the coordinator and is emitted by tsc into the child's runtime tree.
export const runtimeEntryRelative = "apps/api/tests/integration/generation-process-fixture.js";
export const runtimeEntryRelatives = Object.freeze({ generation: runtimeEntryRelative,
  abuse: "apps/api/tests/integration/abuse-process-fixture.js",
  scheduler: "apps/api/tests/integration/f1-scheduler-process-fixture.js" });
const criticalSourceModules = ["db/client", "config/env", "config/abuse", "shared/abuse-control", "shared/abuse-errors",
  "shared/request-identity", "modules/auth/service", "modules/auth/routes", "modules/auth/identity",
  "modules/auth/repository", "modules/auth/identity-audit", "modules/signals/scheduler", "modules/signals/service-generated",
  "modules/auth/identity-mirror", "modules/admin/repository",
  "modules/signals/replica-audit", "modules/signals/generation-repository", "plugins/redis",
  "modules/signals/scheduler-repository", "modules/signals/scheduler-time", "modules/signals/scheduler-types",
  "modules/ai/service", "modules/ai/repository", "modules/ai/provider-execution", "modules/ai/embedding-space", "modules/signals/service-embedding", "modules/ai/provider-config", "modules/ai/provider-transport", "modules/ai/provider-health", "modules/ai/embedding", "modules/ai/reranker", "modules/ai/tts",
  "modules/ai/provider", "modules/ai/provider-prompts", "modules/ai/schemas", "modules/ai/expansion-review-rules", "modules/ai/signal-quality-evaluator", "modules/admin/ai-evaluation",
  "modules/signals/service-creation", "modules/ai/reranker-adapter", "modules/signals/match-scoring", "modules/signals/match-policy", "modules/signals/match-evaluation", "modules/frontend-diagnostics/routes", "db/schema",
  "modules/signals/service-queries", "modules/signals/service-matching", "modules/signals/service-interactions",
  "modules/signals/service-publication-confirmation", "modules/signals/service-withdrawal", "modules/signals/service-publishing",
  "modules/signals/publication-policy", "modules/signals/galaxy-sampling", "modules/signals/history-cursor", "modules/monthly-recaps/repository", "modules/signals/repository", "modules/signals/publication-repository", "modules/signals/publication", "modules/signals/schemas", "modules/signals/audio-repository", "modules/signals/audio-worker",
  "modules/signals/service-audio", "modules/signals/routes", "modules/signals/audio-storage", "modules/signals/service-mappers",
  "modules/signals/interpretation", "modules/signals/frequency-taxonomy",
  "modules/monthly-recaps/service", "modules/monthly-recaps/types", "modules/ai/signal-types",
  "shared/shutdown-budget", "shared/log-redaction", "scripts/migrate", "server"];
// This explicit inventory makes a new/renamed migration fail preparation until
// its SQL is included in the same input and runtime-artifact freeze.
export const migrationPayloadPaths = Object.freeze([
  "apps/api/src/db/migrations/meta/_journal.json",
  ...[
    "0000_material_retro_girl", "0001_famous_the_anarchist", "0002_natural_omega_sentinel",
    "0003_aberrant_thena", "0004_romantic_proemial_gods", "0005_milky_karen_page",
    "0006_greedy_silver_sable", "0007_fast_skrulls", "0008_youthful_living_lightning",
    "0009_clean_shadowcat", "0010_famous_the_anarchist", "0011_common_black_cat",
    "0012_massive_ser_duncan", "0013_confused_paper_doll", "0014_calm_siren",
    "0015_chunky_raider", "0016_tricky_mephistopheles", "0017_amazing_colossus",
    "0018_exotic_kabuki", "0019_acoustic_ultragirl", "0020_provider_config_fallbacks",
    "0021_absurd_firedrake", "0022_signal_generation_leases", "0023_b3_audio_attempt",
    "0024_c1_publication_foundation", "0025_e1_provider_execution", "0026_f1_ai_signal_scheduler",
  ].map((name) => `apps/api/src/db/migrations/${name}.sql`),
]);
export const runtimeArtifactPaths = Object.freeze([
  "package.json", "scripts/integration-runtime.mjs", runtimeEntryRelative,
  runtimeEntryRelatives.abuse,
  runtimeEntryRelatives.scheduler,
  "apps/api/tests/integration/generation-test-controls.js",
  "apps/api/tests/integration/fixtures.js", "apps/api/src/app.js",
  "apps/api/src/shared/generation-execution.js",
  "apps/api/src/modules/signals/generation-worker.js",
  ...migrationPayloadPaths,
  ...criticalSourceModules.map((name) => `apps/api/src/${name}.js`),
]);
export const runtimeSourcePaths = Object.freeze([
  "scripts/apply-postgres-lifecycle-patch.mjs", "patches/postgres-4.0.0-lifecycle.json",
  "patches/postgres-4.0.0-lifecycle.patch", "tests/integration/postgres-module.test.mjs",
  "node_modules/postgres/package.json", "node_modules/postgres/src/pool.js", "node_modules/postgres/src/index.js",
  "package.json", "package-lock.json", "apps/api/package.json",
  "apps/api/tests/integration/postgres-eof.test.ts", "apps/api/tests/integration/failures.test.ts",
  "apps/api/tests/integration/core-flow.test.ts", "packages/contracts/src/signals.ts",
  "apps/api/tests/integration/migration-cli.test.ts",
  "apps/api/tests/integration/provider-stub.ts", "apps/api/tests/integration/matching-evaluation.ts", "apps/api/tests/fixtures/e3-matches.v1.json", "apps/api/tests/fixtures/e3-matches.v1.sha256",
  "apps/api/tsconfig.json", "apps/api/tsconfig.integration-runtime.json",
  "apps/api/tests/integration/generation-process-fixture.ts",
  "apps/api/tests/integration/generation-test-controls.ts",
  "apps/api/tests/integration/fixtures.ts", "apps/api/src/app.ts",
  "apps/api/tests/integration/harness.ts",
  "apps/api/src/shared/generation-execution.ts",
  "apps/api/src/modules/signals/generation-worker.ts",
  "apps/api/tests/integration/generation-harness.ts",
  "apps/api/tests/integration/generation-checkpoints.test.ts",
  "scripts/integration-runtime.mjs",
  "apps/api/tests/integration/abuse-process-fixture.ts",
  "apps/api/tests/integration/f1-scheduler-process-fixture.ts",
  "apps/api/tests/integration/f2-recovery.test.ts", "scripts/deployment-stack.sh",
  "tests/integration/f2-linux-backup-permissions.sh",
  ...migrationPayloadPaths,
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
  const journal = JSON.parse((await ordinaryFile(path.join(root, migrationPayloadPaths[0]))).toString("utf8"));
  if (!Array.isArray(journal.entries) || journal.entries.length !== migrationPayloadPaths.length - 1 ||
      journal.entries.some((entry, index) => !entry || typeof entry.tag !== "string" ||
        `apps/api/src/db/migrations/${entry.tag}.sql` !== migrationPayloadPaths[index + 1])) fail();
  const inputs = await hashes(root, sourcePaths);
  await writeFile(path.join(runtimeDirectory, "package.json"), '{"type":"module"}\n', { flag: "wx" });
  await compile(runtimeDirectory);
  // tsc emits the real CLI but does not emit its SQL payload. Copy only the
  // registered ordinary inputs into the exclusively owned fresh runtime.
  for (const relative of migrationPayloadPaths) {
    const output = path.join(runtimeDirectory, relative);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, await ordinaryFile(path.join(root, relative)), { flag: "wx" });
  }
  equalHashes(await hashes(root, sourcePaths), inputs, sourcePaths);
  const files = await hashes(runtimeDirectory, runtimeArtifactPaths);
  if (migrationPayloadPaths.some((relative) => files[relative] !== inputs[relative])) fail();
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
      Object.keys(marker.entryRelatives).length !== Object.keys(runtimeEntryRelatives).length ||
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
