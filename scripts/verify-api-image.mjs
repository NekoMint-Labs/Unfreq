import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOwnedWebBuilder } from "./web-image-builder.mjs";

const usage = "Usage: node scripts/verify-api-image.mjs [--resume-runtime=<owned-run-id> | --resume-shutdown=<owned-run-id>]\nBuild the real Linux API runner and test it with disposable PostgreSQL/Redis and synthetic data.\nResume accepts only a prior owned build with identical Docker inputs and probe.\n";
if (process.argv.length === 3 && process.argv[2] === "--help") { console.log(usage); process.exit(0); }
const resumeMatch = process.argv.length === 3 ? /^--resume-(runtime|shutdown)=([a-f0-9]{24})$/u.exec(process.argv[2]) : null;
if (process.argv.length !== 2 && !resumeMatch) { console.error(usage); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = randomBytes(12).toString("hex");
const label = "com.unfreq.api-image-verification.run";
const networkName = `unfreq-api-image-${runId}`;
const volumeName = `${networkName}-pgdata`;
const imageTag = `unfreq-api-verify:${runId}`;
const deadline = performance.now() + 30 * 60_000;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lines = (value) => value.trim().split(/\s+/u).filter(Boolean);
const localEndpoint = (value) => /^npipe:\/{4}\.\/pipe\/[a-z0-9_.-]+$/iu.test(value) || /^unix:\/\/\/[^/?#\0][^?#\0]*$/u.test(value);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
  "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE",
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_CLI_PLUGIN_EXTRA_DIRS",
  "CI", "NO_COLOR", "FORCE_COLOR",
].includes(key.toUpperCase())).map(([key, value]) => [key.toUpperCase(), value]));
const verificationPaths = ["scripts/verify-api-image.mjs", "scripts/web-image-builder.mjs", "tests/images/api-image-probe.mjs"];
const activeShutdown = resumeMatch?.[1] === "shutdown";
const extraVerificationPaths = activeShutdown ? ["api-image-active-shutdown.mjs", "api-image-held-provider.mjs", "api-image-active-probe.mjs"].map((name) => `tests/images/${name}`) : [];
const manifest = { runId, startedAt: new Date().toISOString(), syntheticOnly: true,
  scope: activeShutdown
    ? "Previously built real API image, synthetic production HTTP/PG/Redis and in-flight local Provider shutdown/restart; not production or remote paid computation."
    : "Real Dockerfile.api runner, production-mode synthetic HTTP/PG/Redis checks and idle SIGTERM; not production or active-job drain acceptance.",
  sourceScope: "Frozen Docker COPY inputs plus verifier/probe sources; not an entire repository signature.",
  stages: [], images: {}, inputs: {}, verificationInputs: {}, failures: [], stops: [], cleanupFailures: [] };
let directory, endpoint, builder, activeChild;
let dockerValidated = false, interrupted = false, cleaning = false;
let exitCode = 1;
const containers = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; activeChild?.kill("SIGKILL"); });
async function save() {
  if (directory) await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
async function run(command, args, { capture = true, childEnv = env, cwd = root, timeoutMs = 30_000 } = {}) {
  if (interrupted && !cleaning) throw new Error("API image verification interrupted.");
  if (!cleaning) timeoutMs = Math.min(timeoutMs, deadline - performance.now() - 120_000);
  assert.ok(timeoutMs > 0, "API image verification work deadline exceeded");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; if (!capture) process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (!capture) process.stderr.write(chunk); });
    child.once("error", (error) => { clearTimeout(timer); if (activeChild === child) activeChild = undefined; reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = undefined;
      if (code !== 0 || timedOut) reject(Object.assign(new Error(`${path.basename(command)} ${args[0]} failed (${timedOut ? "timeout" : signal ?? code}).`), { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
const docker = (args, options) => run("docker", endpoint ? ["--host", endpoint, ...args] : args, options);
async function inspectOwned(kind, id) {
  const values = JSON.parse((await docker([kind, "inspect", id])).stdout);
  assert.equal(values.length, 1);
  const value = values[0];
  assert.equal(kind === "container" ? value.Config.Labels[label] : value.Labels[label], runId, "Resource ownership changed");
  return value;
}
async function createContainer(role, image, options = [], command = [], start = true) {
  const name = `${networkName}-${role}`;
  const result = await docker(["create", "--name", name, "--label", `${label}=${runId}`,
    "--network", networkName, "--network-alias", role, "--security-opt", "no-new-privileges",
    "--pids-limit", "128", ...options, image, ...command]);
  const id = result.stdout.trim();
  containers.add(id);
  const inspected = await inspectOwned("container", id);
  assert.deepEqual(inspected.HostConfig.PortBindings, {}, "Host port publication is refused");
  if (start) await docker(["start", id]);
  return id;
}
async function untilReady(id, command, timeoutMs = 60_000) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    const value = await inspectOwned("container", id);
    assert.equal(value.State.Running, true, "Owned container exited during startup");
    try { return await docker(["exec", id, ...command], { timeoutMs: 10_000 }); }
    catch { await new Promise((resolve) => setTimeout(resolve, 300)); }
  }
  throw new Error("Owned API service did not become ready within its startup budget.");
}
async function resolveImage(name, preferLocal = false) {
  if (preferLocal) {
    let local;
    try { local = JSON.parse((await docker(["image", "inspect", name])).stdout)[0]; } catch { /* Resolve missing images from registry below. */ }
    if (local) {
      const repository = name.replace(/:[^/:]+$/u, "");
      const reference = local.RepoDigests?.find((value) => value.startsWith(repository + "@sha256:"));
      if (reference) {
        assert.match(reference.slice(repository.length), /^@sha256:[a-f0-9]{64}$/u);
        assert.equal(local.Os, "linux");
        assert.equal(local.Architecture, "amd64");
        manifest.images[name] = { reference, id: local.Id, resolution: "Previously installed local Docker RepoDigest, not a latest-version lookup." };
        return reference;
      }
    }
  }
  const descriptor = JSON.parse((await docker(["buildx", "imagetools", "inspect", name, "--format", "{{json .Manifest}}"], { timeoutMs: 120_000 })).stdout);
  assert.match(descriptor.digest, /^sha256:[a-f0-9]{64}$/u);
  const reference = `${name}@${descriptor.digest}`;
  manifest.images[name] = { reference, descriptor };
  return reference;
}
async function resumeOwnedBuild(id) {
  const base = path.join(root, "test-results", "api-image");
  const matches = (await readdir(base, { withFileTypes: true })).filter((entry) => entry.name.startsWith(`run-${id}-`));
  assert.equal(matches.length, 1, "Resume requires exactly one prior owned run directory");
  assert.ok(matches[0].isDirectory() && !matches[0].isSymbolicLink());
  const previousDirectory = path.join(base, matches[0].name);
  for (let part = previousDirectory; part !== root; part = path.dirname(part)) assert.equal((await lstat(part)).isSymbolicLink(), false);
  const filename = path.join(previousDirectory, "manifest.json");
  assert.equal((await lstat(filename)).isSymbolicLink(), false);
  const bytes = await readFile(filename);
  const previous = JSON.parse(bytes);
  assert.equal(previous.runId, id);
  assert.equal(previous.syntheticOnly, true);
  assert.equal(previous.builderReleasedBeforeRuntime, true);
  assert.equal(previous.builder?.cleaned, true);
  assert.deepEqual(previous.stages.map(({ target, exitCode }) => ({ target, exitCode })),
    ["deps", "prod-deps", "runner"].map((target) => ({ target, exitCode: 0 })));
  assert.deepEqual(previous.inputs, manifest.inputs, "Docker inputs changed since the prior build");
  assert.equal(previous.sourceTreeSha256, manifest.sourceTreeSha256);
  for (const [relative, expected] of Object.entries(previous.inputs)) {
    const oldPath = path.join(previousDirectory, "context", relative);
    assert.equal((await lstat(oldPath)).isSymbolicLink(), false);
    assert.equal(sha(await readFile(oldPath)), expected, `Prior frozen input changed: ${relative}`);
  }
  assert.deepEqual(Object.keys(previous.verificationInputs).sort(), verificationPaths.slice().sort());
  for (const [relative, expected] of Object.entries(previous.verificationInputs)) {
    assert.equal(sha(await readFile(path.join(previousDirectory, "verification", relative))), expected);
    if (relative !== "scripts/verify-api-image.mjs") assert.equal(manifest.verificationInputs[relative], expected, `Probe/builder changed: ${relative}`);
  }
  assert.match(previous.image.id, /^sha256:[a-f0-9]{64}$/u);
  const image = JSON.parse((await docker(["image", "inspect", previous.image.id])).stdout)[0];
  assert.equal(image.Id, previous.image.id);
  assert.equal(image.Config.Labels[label], id);
  assert.equal(image.Config.Labels["com.unfreq.api-image-verification.source"], manifest.sourceTreeSha256);
  assert.equal(image.Os, "linux");
  assert.equal(image.Architecture, "amd64");
  assert.deepEqual(image.Config.Cmd, ["./scripts/api-entrypoint.sh"]);
  manifest.image = previous.image;
  manifest.buildReference = { runId: id, directory: previousDirectory, manifestSha256: sha(bytes), imageId: image.Id,
    dockerInputsVerified: true, probeAndBuilderUnchanged: true, verifierChanged: previous.verificationInputs["scripts/verify-api-image.mjs"] !== manifest.verificationInputs["scripts/verify-api-image.mjs"] };
  manifest.runtimeOnly = true;
  console.log(`Resuming runtime of owned image ${image.Id}`);
}
async function verifySources(frozen) {
  for (const [relative, expected] of Object.entries(manifest.inputs)) {
    assert.equal(sha(await readFile(path.join(root, relative))), expected, `Source changed: ${relative}`);
    assert.equal(sha(await readFile(path.join(frozen, relative))), expected, `Frozen input changed: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(manifest.verificationInputs)) {
    assert.equal(sha(await readFile(path.join(root, relative))), expected, `Verifier changed: ${relative}`);
    assert.equal(sha(await readFile(path.join(directory, "verification", relative))), expected);
  }
}
try {
  if (env.DOCKER_HOST) assert.ok(localEndpoint(env.DOCKER_HOST), "Remote Docker endpoints are refused");
  const name = (await docker(["context", "show"])).stdout.trim();
  const context = JSON.parse((await docker(["context", "inspect", name])).stdout)[0];
  assert.ok(localEndpoint(context.Endpoints?.docker?.Host ?? ""));
  endpoint = env.DOCKER_CONTEXT ? context.Endpoints.docker.Host : env.DOCKER_HOST ?? context.Endpoints.docker.Host;
  assert.ok(localEndpoint(endpoint));
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  manifest.dockerVersion = (await docker(["info", "--format", "{{.ServerVersion}}"])).stdout.trim();
  dockerValidated = true;
  await mkdir(path.join(root, "test-results", "api-image"), { recursive: true });
  directory = await mkdtemp(path.join(root, "test-results", "api-image", `run-${runId}-`));
  manifest.sourceCommit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  manifest.sourceStatus = (await run("git", ["status", "--porcelain=v1"])).stdout.trim();
  console.log(`Linux API image verification: ${runId}\nEvidence: ${directory}`);
  const tracked = (await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
  const paths = [...new Set(tracked)].filter((relative) => [".dockerignore", "Dockerfile.api", "package.json", "package-lock.json",
    "apps/web/package.json", "scripts/apply-postgres-lifecycle-patch.mjs", "scripts/api-entrypoint.sh"].includes(relative) ||
    /^(apps\/api\/|packages\/contracts\/|patches\/)/u.test(relative)).sort();
  const frozen = path.join(directory, "context");
  for (const [base, selected, hashes] of [[frozen, paths, manifest.inputs],
    [path.join(directory, "verification"), [...verificationPaths, ...extraVerificationPaths], manifest.verificationInputs]]) {
    for (const relative of selected) {
      assert.ok(!relative.split("/").some((part) => ["node_modules", "dist", ".git", "test-results"].includes(part)));
      assert.ok(!/^\.env(?:\.|$)/u.test(path.basename(relative)) || path.basename(relative).endsWith(".example"), "Environment files are refused");
      const source = path.resolve(root, relative);
      assert.ok(source.startsWith(root + path.sep));
      for (let part = source; part !== root; part = path.dirname(part)) assert.equal((await lstat(part)).isSymbolicLink(), false);
      const bytes = await readFile(source);
      hashes[relative] = sha(bytes);
      await mkdir(path.dirname(path.join(base, relative)), { recursive: true });
      await writeFile(path.join(base, relative), bytes, { flag: "wx" });
    }
  }
  assert.ok(paths.length > 30);
  const entrypoint = await readFile(path.join(frozen, "scripts/api-entrypoint.sh"), "utf8");
  assert.ok(!entrypoint.includes("\r"), "Linux entrypoint must use LF line endings");
  assert.ok(entrypoint.endsWith("exec node dist/server.js\n"), "API process must receive container stop signals directly");
  manifest.sourceTreeSha256 = sha(JSON.stringify(manifest.inputs));
  await save();
  if (resumeMatch) {
    await resumeOwnedBuild(resumeMatch[2]);
  } else {
  const nodeImage = await resolveImage("node:22-alpine");
  builder = createOwnedWebBuilder({ docker, env, directory, runId, endpoint });
  manifest.builder = builder.record;
  await builder.start();
  await save();
  for (const target of ["deps", "prod-deps", "runner"]) {
    const started = performance.now();
    console.log(`Building API ${target}`);
    try {
      const result = await builder.build([...(target === "runner" ? ["--load", "--tag", imageTag] : ["--output", "type=cacheonly"]),
        "--platform", "linux/amd64", "--target", target, "--progress", "plain", "--file", path.join(frozen, "Dockerfile.api"),
        "--build-arg", `NODE_IMAGE=${nodeImage}`, "--label", `${label}=${runId}`,
        "--label", `com.unfreq.api-image-verification.source=${manifest.sourceTreeSha256}`,
        "--metadata-file", path.join(directory, `build-metadata-${target}.json`), frozen], { capture: false, timeoutMs: 900_000 });
      await writeFile(path.join(directory, `build-${target}.log`), result.stdout + result.stderr);
      manifest.stages.push({ target, elapsedMs: performance.now() - started, exitCode: 0 });
    } catch (error) {
      await writeFile(path.join(directory, `build-${target}.log`), (error.stdout ?? "") + (error.stderr ?? ""));
      throw error;
    }
    await save();
  }
  const image = JSON.parse((await docker(["image", "inspect", imageTag])).stdout)[0];
  assert.equal(image.Config.Labels[label], runId);
  assert.equal(image.Os, "linux");
  assert.equal(image.Architecture, "amd64");
  assert.deepEqual(image.Config.Cmd, ["./scripts/api-entrypoint.sh"]);
  manifest.image = { tag: imageTag, id: image.Id, os: image.Os, architecture: image.Architecture, sizeBytes: image.Size };
  assert.equal(await builder.cleanup(), true, "Private builder cleanup failed");
  }
  manifest.builderReleasedBeforeRuntime = true;
  await save();

  // Pull before creating an internal network. The application has no external
  // network, host ports, mounted credentials or real provider configuration.
  const pgImage = await resolveImage("pgvector/pgvector:pg16", true);
  const redisImage = await resolveImage("redis:7-alpine", true);
  for (const reference of [pgImage, redisImage]) {
    let present = false;
    try { await docker(["image", "inspect", reference]); present = true; } catch { /* Pull only missing pinned images. */ }
    if (!present) await docker(["pull", "--platform", "linux/amd64", reference], { timeoutMs: 300_000 });
  }
  assert.deepEqual(lines((await docker(["network", "ls", "--quiet", "--filter", `name=^${networkName}$`])).stdout), []);
  await docker(["network", "create", "--internal", "--label", `${label}=${runId}`, networkName]);
  assert.equal((await inspectOwned("network", networkName)).Internal, true);
  assert.deepEqual(lines((await docker(["volume", "ls", "--quiet", "--filter", `name=^${volumeName}$`])).stdout), []);
  await docker(["volume", "create", "--label", `${label}=${runId}`, volumeName]);
  await inspectOwned("volume", volumeName);
  const password = randomBytes(24).toString("hex");
  const pg = await createContainer("postgres", pgImage, ["--memory", "256m", "--mount", `type=volume,source=${volumeName},target=/var/lib/postgresql/data`,
    "--env", "POSTGRES_USER=postgres", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=unfreq_image"]);
  await untilReady(pg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "unfreq_image"]);
  const redis = await createContainer("redis", redisImage, ["--memory", "128m", "--tmpfs", "/data"], ["redis-server", "--save", "", "--appendonly", "no"]);
  await untilReady(redis, ["redis-cli", "ping"]);
  const ruleSource = await readFile(path.join(frozen, "apps/api/src/config/abuse.ts"), "utf8");
  const ruleNames = [...ruleSource.split("export const ruleNames = [")[1].split("] as const;")[0].matchAll(/"([A-Za-z]+)"/gu)].map((match) => match[1]);
  assert.ok(ruleNames.length >= 23);
  const paid = new Set(["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"]);
  const policy = { namespace: `image-${runId}`, budgets: Object.fromEntries(ruleNames.map((key) => [key, { limit: paid.has(key) ? 0 : 100, windowMs: 60_000 }])),
    pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000 };
  const apiEnv = { NODE_ENV: "production", API_HOST: "0.0.0.0", API_PORT: "4000", WEB_ORIGIN: "https://image-test.example",
    DATABASE_URL: `postgres://postgres:${password}@postgres:5432/unfreq_image`, REDIS_URL: "redis://redis:6379",
    SESSION_SECRET: randomBytes(32).toString("hex"), PROVIDER_CONFIG_SECRET: randomBytes(32).toString("hex"), ABUSE_HMAC_SECRET: randomBytes(32).toString("hex"),
    ABUSE_PROTECTION_ENABLED: "true", ABUSE_LIMITS_JSON: JSON.stringify(policy), AUTH_LOGIN_DELIVERY_MODE: "disabled", AUTH_LOGIN_CODE_RESPONSE: "disabled",
    SIGNAL_GENERATION_WORKER_ENABLED: "false", AI_SIGNAL_SCHEDULER_ENABLED: "false", UNFREQ_IMAGE_VERIFICATION_RUN: runId, NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  const api = await createContainer("api", manifest.image.id, ["--memory", "512m", "--cap-drop", "ALL",
    ...Object.entries(apiEnv).flatMap(([key, value]) => ["--env", `${key}=${value}`])]);
  await untilReady(api, ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:4000/health',{signal:AbortSignal.timeout(1500)});if(r.status!==200)process.exit(1);"]);
  const processInfo = JSON.parse((await docker(["exec", api, "node", "--input-type=module", "-e",
    "import{readFileSync}from'node:fs';console.log(JSON.stringify({pid1:readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean)}));"])).stdout);
  assert.deepEqual(processInfo.pid1, ["node", "dist/server.js"]);
  manifest.process = processInfo;
  for (const [source, destination] of [[path.join(directory, "verification/tests/images/api-image-probe.mjs"), "/tmp/api-image-probe.mjs"],
    [path.join(frozen, "patches/postgres-4.0.0-lifecycle.json"), "/tmp/postgres-lifecycle.json"]]) await docker(["cp", source, `${api}:${destination}`]);
  const probe = await docker(["exec", api, "node", "/tmp/api-image-probe.mjs"], { timeoutMs: 90_000 });
  await writeFile(path.join(directory, "probe.json"), probe.stdout);
  manifest.probe = JSON.parse(probe.stdout);
  assert.ok(manifest.probe.passed >= 18);
  assert.equal(manifest.probe.passed, manifest.probe.checks.length);

  assert.equal((await inspectOwned("container", api)).State.Running, true);
  const stopStarted = performance.now();
  await docker(["stop", "--time", "35", api], { timeoutMs: 45_000 });
  const stopped = await inspectOwned("container", api);
  const logs = await docker(["logs", api]);
  await writeFile(path.join(directory, "api.log"), logs.stdout + logs.stderr);
  const stop = { elapsedMs: performance.now() - stopStarted, exitCode: stopped.State.ExitCode, oomKilled: stopped.State.OOMKilled,
    running: stopped.State.Running, dead: stopped.State.Dead, error: stopped.State.Error, signal: stopped.Config.StopSignal || "SIGTERM" };
  manifest.stops.push(stop);
  await save();
  assert.equal(stop.exitCode, 0, "API must finish its own graceful shutdown; forced/signal termination is not a pass");
  assert.equal(stop.oomKilled, false);
  assert.equal(stop.running, false);
  assert.equal(stop.dead, false);
  assert.equal(stop.error, "");
  assert.match(logs.stdout + logs.stderr, /api server shutting down/u);
  if (activeShutdown) {
    const { verifyActiveShutdown } = await import(pathToFileURL(path.join(directory, "verification/tests/images/api-image-active-shutdown.mjs")).href);
    manifest.activeShutdown = {};
    await verifyActiveShutdown({ docker, createContainer, untilReady, inspectOwned, imageId: manifest.image.id,
      apiEnv, policy, pg, directory, runId, record: manifest.activeShutdown, save });
  }
  await verifySources(frozen);
  manifest.sourceVerified = true;
  exitCode = 0;
} catch (error) {
  manifest.failures.push({ code: "API_IMAGE_VERIFICATION_FAILED", message: error.message });
  console.error(error.message);
  if (directory) await writeFile(path.join(directory, "failure.log"), `${error.stack ?? error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
} finally {
  cleaning = true;
  let cleaned = true;
  const cleanupFailed = (resource, error) => {
    cleaned = false;
    manifest.cleanupFailures.push({ resource, message: error.message });
  };
  if (dockerValidated) {
    if (builder && !await builder.cleanup()) cleanupFailed("builder", new Error("Owned builder cleanup failed"));
    try {
      for (const id of lines((await docker(["container", "ls", "--all", "--quiet", "--filter", `label=${label}=${runId}`])).stdout)) {
        const value = await inspectOwned("container", id);
        containers.add(value.Id);
      }
    } catch (error) { cleanupFailed("container-discovery", error); }
    for (const id of containers) {
      try {
        const value = await inspectOwned("container", id);
        try {
          const logs = await docker(["logs", id]);
          await writeFile(path.join(directory, `${value.Name.slice(1)}.log`), logs.stdout + logs.stderr);
        } catch (error) { cleanupFailed("container-log", error); }
        if (value.State.Running) await docker(["stop", "--time", "35", id], { timeoutMs: 45_000 });
        await docker(["container", "rm", id]);
      } catch (error) { cleanupFailed("container", error); }
    }
    for (const kind of ["volume", "network"]) {
      try {
        const ids = lines((await docker([kind, "ls", "--quiet", "--filter", `label=${label}=${runId}`])).stdout);
        for (const id of ids) { await inspectOwned(kind, id); await docker([kind, "rm", id]); }
        assert.deepEqual(lines((await docker([kind, "ls", "--quiet", "--filter", `label=${label}=${runId}`])).stdout), []);
      } catch (error) { cleanupFailed(kind, error); }
    }
    try { assert.deepEqual(lines((await docker(["container", "ls", "--all", "--quiet", "--filter", `label=${label}=${runId}`])).stdout), []); }
    catch (error) { cleanupFailed("container-readback", error); }
  }
  if (!cleaned) exitCode = 1;
  if (interrupted) exitCode = 130;
  Object.assign(manifest, { cleaned, interrupted, finishedAt: new Date().toISOString(), exitCode });
  await save();
}
process.exitCode = exitCode;
