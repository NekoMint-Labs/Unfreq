import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createOwnedWebBuilder } from "./web-image-builder.mjs";
import { assertOwnedWebStop } from "./web-image-stop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node scripts/verify-web-image.mjs\nBuild and verify a fresh, locally owned Linux Web image with synthetic data only.\n";
if (process.argv.length === 3 && process.argv[2] === "--help") { console.log(usage); process.exit(0); }
if (process.argv.length !== 2) { console.error(usage); process.exit(1); }
const runId = randomBytes(12).toString("hex");
const labelKey = "com.unfreq.web-image-verification.run";
const imageTag = `unfreq-web-verify:${runId}`;
const network = `unfreq-web-${runId}`;
const fixturePaths = [
  ["tests/e2e/runtime/mock-api.mjs", "runtime/mock-api.mjs"],
  ["tests/e2e/runtime/interpretation-fixture.mjs", "runtime/interpretation-fixture.mjs"],
  ["tests/e2e/publication-fixture.mjs", "publication-fixture.mjs"],
  ...["web-image-probe.mjs", "web-fetch-guard.mjs", "web-runtime.mjs"].map((name) => [`tests/images/${name}`, name]),
];
const containers = new Set();
const liveContainers = new Set();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
  "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE",
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_CLI_PLUGIN_EXTRA_DIRS",
  "PLAYWRIGHT_BROWSERS_PATH", "CI", "NO_COLOR", "FORCE_COLOR",
].includes(key.toUpperCase())).map(([key, value]) => [key.toUpperCase(), value]));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let directory;
let activeChild;
let interrupted = false;
let dockerValidated = false;
let pinnedEndpoint;
let ownedBuilder;
let exitCode = 1;
const manifest = { runId, ownerPid: process.pid, token: randomBytes(24).toString("hex"),
  startedAt: new Date().toISOString(), syntheticOnly: true, hostPlatform: process.platform, hostNode: process.versions.node,
  browserScope: "Host Chromium accessing Linux Web server; not a Linux browser or physical device test.",
  fetchGuardScope: "Container Next global.fetch only with blocked external DNS; not an OS egress firewall or all host-browser traffic.",
  stops: [], failures: [], sourceScope: "Exact frozen Docker COPY inputs, not an entire repository signature." };
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  interrupted = true;
  activeChild?.kill(signal);
});
async function save() {
  if (directory) await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
async function run(command, args, { capture = true, childEnv = env, cwd = root, timeoutMs = 30_000 } = {}) {
  if (interrupted) throw new Error("Image verification interrupted.");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; if (!capture) process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (!capture) process.stderr.write(chunk); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = undefined;
      if (code !== 0 || timedOut) {
        reject(Object.assign(new Error(`${path.basename(command)} ${args[0] ?? ""} failed (${timedOut ? "timeout" : signal ?? code}).`), { stdout, stderr }));
      } else resolve({ stdout, stderr });
    });
  });
}
const docker = (args, options) => run("docker", pinnedEndpoint === undefined ? args : ["--host", pinnedEndpoint, ...args], options);
const localEndpoint = (value) => /^npipe:\/{4}\.\/pipe\/[a-z0-9_.-]+$/iu.test(value) || /^unix:\/\/\/[^/?#\0][^?#\0]*$/u.test(value);
async function inspectContainer(id) {
  const value = JSON.parse((await docker(["inspect", id])).stdout)[0];
  assert.equal(value.Config.Labels[labelKey], runId, "Container ownership mismatch");
  return value;
}
async function createContainer(role, extra, command = []) {
  const name = `unfreq-web-${runId}-${role}`;
  const result = await docker(["create", "--name", name, "--label", `${labelKey}=${runId}`,
    "--label", `com.unfreq.web-image-verification.role=${role}`, "--network", network,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--dns", "127.0.0.1",
    "--env", "NPM_CONFIG_UPDATE_NOTIFIER=false", ...extra, manifest.image.id, ...command]);
  const id = result.stdout.trim();
  containers.add(id);
  await inspectContainer(id);
  return id;
}
async function portOf(id, containerPort) {
  const value = await inspectContainer(id);
  const entries = value.NetworkSettings.Ports?.[`${containerPort}/tcp`];
  assert.equal(entries?.length, 1);
  const binding = entries[0];
  const port = Number(binding.HostPort);
  assert.equal(binding.HostIp, "127.0.0.1");
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  return port;
}
async function waitHttp(url, predicate) {
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "error" });
      if (response.ok && await predicate(response)) return;
    } catch { /* bounded startup observation */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Owned Web image did not become ready.");
}
async function stopContainer(id, role) {
  const before = await inspectContainer(id);
  assert.equal(before.State.Running, true, "Owned Web process exited before its stop request");
  assert.ok(liveContainers.has(id), "Owned Web process was not registered as running");
  const signal = before.Config.StopSignal || "SIGTERM";
  const started = performance.now();
  await docker(["stop", "--time", "15", id]);
  liveContainers.delete(id);
  const value = await inspectContainer(id);
  const logs = await docker(["logs", id]);
  await writeFile(path.join(directory, `${role}.log`), logs.stdout + logs.stderr);
  const record = { role, elapsedMs: performance.now() - started, exitCode: value.State.ExitCode,
    oomKilled: value.State.OOMKilled, running: value.State.Running, dead: value.State.Dead,
    error: value.State.Error, stopRequested: true, signal, runningBeforeStop: before.State.Running };
  manifest.stops.push(record);
  await save();
  record.outcome = assertOwnedWebStop(value.State, { role, stopRequested: true, signal });
}

try {
  if (env.DOCKER_HOST && !localEndpoint(env.DOCKER_HOST)) throw new Error("Remote Docker endpoints are refused.");
  const contextName = (await docker(["context", "show"])).stdout.trim();
  const context = JSON.parse((await docker(["context", "inspect", contextName])).stdout)[0];
  assert.ok(localEndpoint(context.Endpoints?.docker?.Host ?? ""), "A local Docker context is required");
  pinnedEndpoint = env.DOCKER_CONTEXT ? context.Endpoints.docker.Host : env.DOCKER_HOST ?? context.Endpoints.docker.Host;
  assert.ok(localEndpoint(pinnedEndpoint));
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  manifest.dockerVersion = (await docker(["info", "--format", "{{.ServerVersion}}"])).stdout.trim();
  dockerValidated = true;
  await mkdir(path.join(root, "test-results", "web-image"), { recursive: true });
  directory = await mkdtemp(path.join(root, "test-results", "web-image", `run-${runId}-`));
  manifest.sourceCommit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  manifest.sourceStatus = (await run("git", ["status", "--porcelain=v1"])).stdout.trim();
  // Freeze verification sources before the potentially long image build too.
  manifest.fixtureInputs = {};
  const fixtureBytes = new Map();
  for (const relative of [...fixturePaths.map(([relative]) => relative), "scripts/verify-web-image.mjs",
    "scripts/web-image-builder.mjs", "scripts/web-image-stop.mjs",
    "playwright.image.config.ts", "tests/e2e/runtime/production.spec.ts", "tests/e2e/runtime/image-only.spec.ts"]) {
    const bytes = await readFile(path.join(root, relative));
    fixtureBytes.set(relative, bytes);
    manifest.fixtureInputs[relative] = sha(bytes);
  }
  console.log(`Linux Web image verification: ${runId}\nEvidence: ${directory}`);

  const allPaths = (await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
  const paths = [...new Set(allPaths)].filter((relative) =>
    [".dockerignore", "Dockerfile.web", "package.json", "package-lock.json", "apps/api/package.json", "scripts/apply-postgres-startup-patch.mjs"].includes(relative) ||
    /^(apps\/web\/|packages\/contracts\/|patches\/)/.test(relative)).sort();
  assert.ok(paths.length > 20);
  manifest.inputs = {};
  const frozen = path.join(directory, "context");
  for (const relative of paths) {
    assert.ok(!relative.split("/").some((part) => ["node_modules", ".next", "dist", ".git", "test-results"].includes(part)));
    assert.ok(!/^\.env(?:\.|$)/.test(path.basename(relative)) || path.basename(relative).endsWith(".example"), "Environment file refused");
    const source = path.resolve(root, relative);
    assert.ok(source.startsWith(root + path.sep));
    const bytes = await readFile(source);
    manifest.inputs[relative] = sha(bytes);
    await mkdir(path.dirname(path.join(frozen, relative)), { recursive: true });
    await writeFile(path.join(frozen, relative), bytes);
  }
  manifest.sourceTreeSha256 = sha(JSON.stringify(manifest.inputs));
  const nodeDescriptor = JSON.parse((await docker(["buildx", "imagetools", "inspect", "node:22-alpine", "--format", "{{json .Manifest}}"], { timeoutMs: 120_000 })).stdout);
  assert.match(nodeDescriptor.digest, /^sha256:[a-f0-9]{64}$/);
  manifest.baseImage = { name: "node:22-alpine", descriptor: nodeDescriptor };
  ownedBuilder = createOwnedWebBuilder({ docker, env, directory, runId, endpoint: pinnedEndpoint });
  manifest.builder = ownedBuilder.record;
  await save();
  await ownedBuilder.start();
  await save();
  const buildStarted = performance.now();
  // The owned container builder caps this run's memory and solver parallelism;
  // it does not select or reconfigure any persistent user builder.
  manifest.buildStages = [];
  // Prime these real Dockerfile targets sequentially so two clean installs and
  // compilation do not compete on a small local host. Final runner uses them.
  for (const target of ["deps", "prod-deps", "runner"]) {
    const stageStarted = performance.now();
    const build = await ownedBuilder.build([...(target === "runner" ? ["--load", "--tag", imageTag] : ["--output", "type=cacheonly"]),
      "--platform", "linux/amd64", "--target", target,
      "--progress", "plain", "--file", path.join(frozen, "Dockerfile.web"),
      "--label", `${labelKey}=${runId}`, "--label", `org.opencontainers.image.revision=${manifest.sourceCommit}`,
      "--label", `com.unfreq.web-image-verification.source=${manifest.sourceTreeSha256}`,
      "--build-arg", `NODE_IMAGE=node:22-alpine@${nodeDescriptor.digest}`, "--build-arg", "NEXT_PUBLIC_API_BASE_URL=/api",
      "--metadata-file", path.join(directory, `build-metadata-${target}.json`), frozen], { capture: false, timeoutMs: 900_000 });
    await writeFile(path.join(directory, `build-${target}.log`), build.stdout + build.stderr);
    manifest.buildStages.push({ target, output: target === "runner" ? "image" : "cacheonly", elapsedMs: performance.now() - stageStarted });
    await save();
  }
  manifest.buildMs = performance.now() - buildStarted;
  const inspected = JSON.parse((await docker(["image", "inspect", imageTag])).stdout)[0];
  assert.equal(inspected.Config.Labels[labelKey], runId);
  assert.deepEqual(inspected.Config.Cmd, ["npm", "--workspace", "@unfreq/web", "run", "start"]);
  manifest.image = { tag: imageTag, id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture,
    repoDigests: inspected.RepoDigests, cmd: inspected.Config.Cmd, sizeBytes: inspected.Size };
  assert.equal(inspected.Os, "linux");
  assert.equal(inspected.Architecture, "amd64");
  const fixtures = path.join(directory, "fixtures");
  await mkdir(path.join(fixtures, "runtime"), { recursive: true });
  for (const [relative, destination] of fixturePaths) {
    assert.equal(sha(await readFile(path.join(root, relative))), manifest.fixtureInputs[relative], "Fixture changed during image build");
    await writeFile(path.join(fixtures, destination), fixtureBytes.get(relative));
  }
  for (const [relative, expected] of Object.entries(manifest.fixtureInputs)) {
    assert.equal(sha(await readFile(path.join(root, relative))), expected, "Verifier changed during image build");
  }
  const mount = `type=bind,source=${fixtures},target=/fixtures,readonly`;
  const probe = await docker(["run", "--rm", "--label", `${labelKey}=${runId}`, "--network", "none", "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,size=16m", "--mount", mount, "--entrypoint", "node", inspected.Id, "/fixtures/web-image-probe.mjs"]);
  const inventory = JSON.parse(probe.stdout);
  await writeFile(path.join(directory, "image-inventory-and-notices.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  manifest.probe = { node: inventory.node, buildId: inventory.buildId, packageCount: inventory.packageCount,
    noticeCount: inventory.noticeCount, linuxSwcLoaded: inventory.linuxSwcLoaded, sharpPngGenerated: inventory.sharpPngGenerated,
    contractsLoaded: inventory.contractsLoaded, forbiddenAbsent: inventory.forbiddenAbsent, links: inventory.links,
    nativeArtifacts: inventory.nativeArtifacts };
  const createdNetwork = await docker(["network", "create", "--driver", "bridge", "--label", `${labelKey}=${runId}`, network]);
  manifest.networkId = createdNetwork.stdout.trim();
  manifest.runtimeNetwork = { driver: "bridge", internal: false, dns: "127.0.0.1", hostBindings: "127.0.0.1 only",
    reason: "This local Engine does not allocate published host ports on internal networks. Next HTTP(S) is separately guarded." };
  const direct = await createContainer("direct", ["--publish", "127.0.0.1::3000"]);
  await docker(["start", direct]); liveContainers.add(direct);
  const directPort = await portOf(direct, 3000);
  await waitHttp(`http://127.0.0.1:${directPort}/web-health`, async () => true);
  await stopContainer(direct, "direct");
  const runtimeId = await createContainer("runtime", ["--init", "--publish", "127.0.0.1::8080", "--mount", mount,
    "--env", `UNFREQ_WEB_IMAGE_RUN_ID=${runId}`, "--entrypoint", "node"], ["/fixtures/web-runtime.mjs"]);
  await docker(["start", runtimeId]); liveContainers.add(runtimeId);
  const port = await portOf(runtimeId, 8080);
  manifest.port = port;
  await waitHttp(`http://127.0.0.1:${port}/__image/identity`, async (response) => (await response.json()).runId === runId);
  await waitHttp(`http://127.0.0.1:${port}/web-health`, async () => true);
  await waitHttp(`http://127.0.0.1:${port}/health`, async (response) => (await response.json()).data.synthetic === true);
  await save();
  const browsers = await run(process.execPath, [path.join(root, "node_modules", "playwright", "cli.js"), "test", "--config", "playwright.image.config.ts"], {
    capture: false, timeoutMs: 900_000, childEnv: { ...env, UNFREQ_WEB_IMAGE_RUN_ID: runId, UNFREQ_WEB_IMAGE_MANIFEST: path.join(directory, "manifest.json"),
      UNFREQ_WEB_IMAGE_OWNER_PID: String(process.pid), UNFREQ_WEB_IMAGE_TOKEN: manifest.token },
  });
  await writeFile(path.join(directory, "browser.log"), browsers.stdout + browsers.stderr);
  const report = JSON.parse(await readFile(path.join(directory, "playwright.json"), "utf8"));
  assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0); assert.equal(report.stats.flaky, 0);
  assert.ok(report.stats.expected >= 37);
  manifest.browsers = report.stats;
  manifest.playwrightVersion = JSON.parse(await readFile(path.join(root, "node_modules", "playwright", "package.json"), "utf8")).version;
  const identity = await (await fetch(`http://127.0.0.1:${port}/__image/identity`)).json();
  assert.equal(identity.blockedFetch, 0);
  manifest.blockedExternalFetch = identity.blockedFetch;
  await stopContainer(runtimeId, "runtime");
  for (const [relative, expected] of Object.entries({ ...manifest.inputs, ...manifest.fixtureInputs })) {
    assert.equal(sha(await readFile(path.join(root, relative))), expected, `Source changed during validation: ${relative}`);
  }
  manifest.sourceVerified = true;
  exitCode = 0;
} catch (error) {
  manifest.failures.push({ code: "IMAGE_VERIFICATION_FAILED", type: error instanceof assert.AssertionError ? "ASSERTION" : "EXECUTION" });
  console.error(error.message);
  if (directory) await writeFile(path.join(directory, "failure.log"), `${error.stack ?? error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
} finally {
  // Cleanup still works after interruption, but only for resources whose exact
  // label is read back. Never accept caller-selected IDs, projects or volumes.
  const wasInterrupted = interrupted;
  interrupted = false;
  let cleaned = true;
  if (dockerValidated) {
    if (ownedBuilder && !await ownedBuilder.cleanup()) cleaned = false;
    // Include resources created before an interrupted CLI acknowledged them.
    try {
      const ids = (await docker(["ps", "--all", "--quiet", "--filter", `label=${labelKey}=${runId}`])).stdout.trim().split(/\s+/).filter(Boolean);
      for (const id of ids) { await inspectContainer(id); containers.add(id); }
    } catch { cleaned = false; }
    for (const id of containers) {
      try {
        const value = await inspectContainer(id);
        if (value.State.Running) await docker(["stop", "--time", "15", id]);
        await docker(["rm", id]);
      } catch { cleaned = false; }
    }
    try {
      const ids = (await docker(["network", "ls", "--quiet", "--filter", `label=${labelKey}=${runId}`])).stdout.trim().split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const value = JSON.parse((await docker(["network", "inspect", id])).stdout)[0];
        assert.equal(value.Labels[labelKey], runId);
        await docker(["network", "rm", id]);
      }
    } catch { cleaned = false; }
    try {
      assert.equal((await docker(["ps", "--all", "--quiet", "--filter", `label=${labelKey}=${runId}`])).stdout.trim(), "");
      assert.equal((await docker(["network", "ls", "--quiet", "--filter", `label=${labelKey}=${runId}`])).stdout.trim(), "");
    } catch { cleaned = false; }
  }
  if (!cleaned) exitCode = 1;
  if (wasInterrupted) exitCode = 130;
  manifest.cleaned = cleaned;
  manifest.interrupted = wasInterrupted;
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = exitCode;
  await save();
}
process.exitCode = exitCode;
