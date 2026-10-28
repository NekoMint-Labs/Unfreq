import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareIntegrationRuntime } from "./integration-runtime.mjs";

// Own every test service from creation to cleanup. Never accept an existing URL,
// caller-selected Compose project, production .env, or production Compose file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "tests", "integration", "compose.yaml");
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const project = `unfreq-it-${runId}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
  "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE",
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY", "DOCKER_CLI_PLUGIN_EXTRA_DIRS", "CI", "NO_COLOR", "FORCE_COLOR",
].includes(key.toUpperCase())).map(([key, value]) => [key.toUpperCase(), value]));
let activeChild;
let interrupted = false;
let cleaning = false;
let started = false;
let cleaned = false;
let runDir;
let envFile;
let exitCode = 1;
const manifest = { project, runId, composeFile, startedAt: new Date().toISOString() };

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    if (!cleaning) activeChild?.kill(signal);
  });
}

async function run(command, args, { capture = false, childEnv = env, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: childEnv, shell: false, windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      const result = { code: code ?? 1, signal, stdout, stderr };
      if (result.code !== 0) {
        reject(new Error(`${path.basename(command)} ${args[0] ?? ""} failed (${signal ?? result.code}).${capture ? `\n${stderr}` : ""}`));
      } else resolve(result);
    });
  });
}

const composeArgs = (...args) => [
  "compose", "--project-name", project, "--file", composeFile, "--env-file", envFile, ...args,
];
const compose = (args, options) => run("docker", composeArgs(...args), options);

function isLocalDockerEndpoint(endpoint) {
  return /^npipe:\/{4}\.\/pipe\/[a-z0-9_.-]+$/iu.test(endpoint) ||
    /^unix:\/\/\/[^/?#\0][^?#\0]*$/u.test(endpoint);
}

async function ownContainerIds() {
  const { stdout } = await compose(["ps", "--all", "--quiet"], { capture: true });
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const inspected = await run("docker", ["inspect", id], { capture: true });
    const container = JSON.parse(inspected.stdout)[0];
    const labels = container.Config?.Labels ?? {};
    if (labels["com.docker.compose.project"] !== project ||
        !["postgres", "redis"].includes(labels["com.docker.compose.service"])) {
      throw new Error("Refusing cleanup: a container does not belong to this test run.");
    }
  }
  return ids;
}

async function servicePort(service, port) {
  const { stdout } = await compose(["port", service, String(port)], { capture: true });
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(stdout);
  const value = match === null ? 0 : Number(match[1]);
  if (value < 1024 || value > 65535 || [5432, 6379].includes(value)) {
    throw new Error(`Refusing unexpected ${service} endpoint.`);
  }
  return value;
}

try {
  if (process.argv.length > 2) throw new Error("This runner accepts no external URLs or project overrides.");
  if (env.DOCKER_HOST && !isLocalDockerEndpoint(env.DOCKER_HOST)) {
    throw new Error("Remote Docker hosts are not allowed for managed integration tests.");
  }
  const contextName = (await run("docker", ["context", "show"], { capture: true })).stdout.trim();
  const context = JSON.parse((await run("docker", ["context", "inspect", contextName], { capture: true })).stdout)[0];
  if (!isLocalDockerEndpoint(context.Endpoints?.docker?.Host ?? "")) {
    throw new Error("Integration tests require a local Docker context.");
  }
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  await mkdir(path.join(root, "test-results", "integration"), { recursive: true });
  runDir = await mkdtemp(path.join(root, "test-results", "integration", "run-"));
  envFile = path.join(runDir, "empty.env");
  await writeFile(envFile, "# Deliberately empty; do not load the project .env.\n");
  await writeFile(path.join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Managed integration project: ${project}\nEvidence: ${runDir}`);
  const compilationStarted = Date.now();
  const runtime = await prepareIntegrationRuntime({
    repositoryRoot: root, runDirectory: runDir, runId,
    compile: (outputDirectory) => run(process.execPath, [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--project", path.join(root, "apps", "api", "tsconfig.integration-runtime.json"),
      "--outDir", outputDirectory,
    ]),
  });
  manifest.runtime = { directory: runtime.runtimeDirectory, entrySha256: runtime.entrySha256,
    compilationMs: Date.now() - compilationStarted };
  if (interrupted) throw new Error("Integration run interrupted.");
  await compose(["version", "--short"]);
  started = true;
  await compose(["up", "--detach", "--wait", "--wait-timeout", "90"]);
  const databasePort = await servicePort("postgres", 5432);
  const redisPort = await servicePort("redis", 6379);
  manifest.endpoints = { postgres: `127.0.0.1:${databasePort}/unfreq_integration`, redis: `127.0.0.1:${redisPort}` };
  manifest.images = [];
  for (const id of await ownContainerIds()) {
    const container = JSON.parse((await run("docker", ["inspect", id], { capture: true })).stdout)[0];
    const image = JSON.parse((await run("docker", ["image", "inspect", container.Image], { capture: true })).stdout)[0];
    manifest.images.push({ service: container.Config.Labels["com.docker.compose.service"], tag: container.Config.Image, id: image.Id, repoDigests: image.RepoDigests });
  }
  if (interrupted) throw new Error("Integration run interrupted.");
  const testEnv = {
    ...env,
    NODE_ENV: "test",
    DOTENV_CONFIG_PATH: envFile,
    UNFREQ_INTEGRATION_MANAGED: "1",
    UNFREQ_INTEGRATION_RUN_ID: runId,
    UNFREQ_INTEGRATION_RUNTIME_DIR: runtime.runtimeDirectory,
    UNFREQ_INTEGRATION_RUNTIME_TOKEN: runtime.ownershipToken,
    UNFREQ_INTEGRATION_REPORT: path.join(runDir, "vitest.json"),
    DATABASE_URL: `postgres://unfreq_test:unfreq_integration_only@127.0.0.1:${databasePort}/unfreq_integration`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    SESSION_SECRET: "integration-session-secret-not-for-production",
    PROVIDER_CONFIG_SECRET: "integration-provider-secret-not-for-production",
    WEB_ORIGIN: "http://127.0.0.1:3300",
  };
  await writeFile(path.join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await run(process.execPath, [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--config", "vitest.integration.config.ts"], { childEnv: testEnv, cwd: path.join(root, "apps", "api") });
  const report = JSON.parse(await readFile(testEnv.UNFREQ_INTEGRATION_REPORT, "utf8"));
  if (report.success !== true || report.numTotalTests < 1 ||
      report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 ||
      report.numPendingTests !== 0 || report.numTodoTests !== 0) {
    throw new Error("Integration report must contain executed passing tests and no failed, skipped or todo cases.");
  }
  manifest.tests = { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests, todo: report.numTodoTests };
  exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Integration run failed.");
} finally {
  cleaning = true;
  if (started) {
    try {
      await ownContainerIds();
      await compose(["down", "--volumes", "--timeout", "5"]);
      const remaining = await run("docker", ["ps", "--all", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], { capture: true });
      if (remaining.stdout.trim()) throw new Error("Managed containers remain after cleanup.");
      const networks = await run("docker", ["network", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], { capture: true });
      if (networks.stdout.trim()) throw new Error("Managed networks remain after cleanup.");
      cleaned = true;
    } catch (error) {
      console.error(`Cleanup failed for ${project}: ${error instanceof Error ? error.message : "unknown error"}`);
      exitCode = 1;
    }
  }
  exitCode = interrupted ? 130 : exitCode;
  if (runDir) {
    await writeFile(path.join(runDir, "manifest.json"), `${JSON.stringify({ ...manifest, finishedAt: new Date().toISOString(), exitCode, interrupted, resourceCreationAttempted: started, cleaned: !started || cleaned }, null, 2)}\n`);
  }
}
process.exitCode = exitCode;
