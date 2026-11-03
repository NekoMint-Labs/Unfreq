import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createOwnedWebBuilder } from "./web-image-builder.mjs";
import { assertOwnedWebStop } from "./web-image-stop.mjs";
import { runWithReferencedTimeout } from "./image-http-ready.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node scripts/verify-web-image.mjs [--resume-runtime=<owned-run-id>]\nBuild and verify a fresh, locally owned Linux Web image with synthetic data only.\nResume verifies a prior owned image with unchanged build inputs and fixtures.\n";
if (process.argv.length === 3 && process.argv[2] === "--help") { console.log(usage); process.exit(0); }
const resumeMatch = process.argv.length === 3 ? /^--resume-runtime=([a-f0-9]{24})$/u.exec(process.argv[2]) : null;
if (process.argv.length !== 2 && !resumeMatch) { console.error(usage); process.exit(1); }
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
const hostVerifierPaths = ["scripts/verify-web-image.mjs", "scripts/image-http-ready.mjs"];
const verificationPaths = [...fixturePaths.map(([relative]) => relative), ...hostVerifierPaths,
  "scripts/web-image-builder.mjs", "scripts/web-image-stop.mjs",
  "playwright.image.config.ts", "tests/e2e/runtime/production.spec.ts", "tests/e2e/runtime/image-only.spec.ts"];
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
      const matched = await runWithReferencedTimeout(async (signal) => {
        const response = await fetch(url, { signal, redirect: "error" });
        return response.ok && await predicate(response);
      }, Math.max(1, Math.min(1500, Math.ceil(deadline - performance.now()))));
      if (matched) return;
    } catch { /* bounded startup observation */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Owned Web image did not become ready.");
}
async function ordinaryFile(base, relative) {
  const boundary = path.resolve(base);
  const filename = path.resolve(boundary, relative);
  assert.ok(filename.startsWith(boundary + path.sep), "Owned file escaped its directory");
  for (let current = filename; current !== boundary; current = path.dirname(current)) {
    assert.equal((await lstat(current)).isSymbolicLink(), false, "Linked owned file/ancestor refused");
  }
  assert.equal((await lstat(filename)).isFile(), true, "Owned input must be an ordinary file");
  assert.equal((await realpath(filename)).toLowerCase(), filename.toLowerCase(), "Owned file path was redirected");
  return readFile(filename);
}
async function resumeOwnedBuild(id) {
  const base = path.join(root, "test-results", "web-image");
  const matches = (await readdir(base, { withFileTypes: true })).filter((entry) => entry.name.startsWith(`run-${id}-`));
  assert.equal(matches.length, 1, "Resume requires exactly one prior owned run directory");
  assert.ok(matches[0].isDirectory() && !matches[0].isSymbolicLink(), "Prior run must be an ordinary directory");
  const previousDirectory = path.join(base, matches[0].name);
  for (let current = previousDirectory; current !== root; current = path.dirname(current)) {
    assert.equal((await lstat(current)).isSymbolicLink(), false, "Linked prior run directory refused");
  }
  const bytes = await ordinaryFile(previousDirectory, "manifest.json");
  const previous = JSON.parse(bytes);
  assert.equal(previous.runId, id);
  assert.equal(previous.syntheticOnly, true);
  assert.equal(previous.builderReleasedBeforeRuntime, true);
  assert.equal(previous.builder?.cleaned, true, "Prior builder must have finished cleanup");
  assert.equal(previous.builder.name, `unfreq-web-${id}`);
  assert.equal(previous.builder.containerName, `buildx_buildkit_unfreq-web-${id}0`);
  assert.equal(previous.builder.volumeName, `buildx_buildkit_unfreq-web-${id}0_state`);
  assert.deepEqual(previous.builder.cleanupFailures, []);
  assert.deepEqual(previous.buildStages?.map(({ target, output }) => ({ target, output })), [
    { target: "deps", output: "cacheonly" }, { target: "prod-deps", output: "cacheonly" }, { target: "runner", output: "image" },
  ], "Resume requires all three real build stages, not another runtime-only result");
  assert.ok(previous.buildStages.every((stage) => Number.isFinite(stage.elapsedMs) && stage.elapsedMs > 0));
  assert.deepEqual(previous.inputs, manifest.inputs, "Build inputs changed since the prior image");
  assert.equal(previous.sourceTreeSha256, manifest.sourceTreeSha256);
  for (const [relative, expected] of Object.entries(previous.inputs)) {
    assert.equal(sha(await ordinaryFile(path.join(previousDirectory, "context"), relative)), expected, `Prior frozen input changed: ${relative}`);
    assert.equal(sha(await ordinaryFile(root, relative)), expected, `Current build input changed: ${relative}`);
  }
  const previousKeys = Object.keys(previous.fixtureInputs ?? {}).sort();
  const expectedKeys = verificationPaths.filter((relative) => relative !== "scripts/image-http-ready.mjs" || Object.hasOwn(previous.fixtureInputs ?? {}, relative)).sort();
  assert.deepEqual(previousKeys, expectedKeys, "Prior verification source set is not recognized");
  const verifierChanges = [];
  let unchangedFixtureSources = 0;
  for (const [relative, expected] of Object.entries(previous.fixtureInputs)) {
    assert.match(expected, /^[a-f0-9]{64}$/u);
    const current = manifest.fixtureInputs[relative];
    if (hostVerifierPaths.includes(relative)) {
      if (current !== expected) verifierChanges.push({ path: relative, beforeSha256: expected, afterSha256: current });
    } else {
      assert.equal(current, expected, `Runtime/browser fixture changed: ${relative}`);
      unchangedFixtureSources++;
    }
  }
  for (const relative of hostVerifierPaths) {
    if (!Object.hasOwn(previous.fixtureInputs, relative)) verifierChanges.push({ path: relative, beforeSha256: null, afterSha256: manifest.fixtureInputs[relative] });
  }
  // Old runs recorded twelve source hashes but copied only these six runtime
  // files. Verify the files that actually exist; do not invent old snapshots.
  for (const [relative, destination] of fixturePaths) {
    assert.equal(sha(await ordinaryFile(path.join(previousDirectory, "fixtures"), destination)), previous.fixtureInputs[relative], `Prior copied fixture changed: ${relative}`);
  }
  const buildMetadata = [];
  for (const target of ["deps", "prod-deps", "runner"]) {
    const metadataBytes = await ordinaryFile(previousDirectory, `build-metadata-${target}.json`);
    const metadata = JSON.parse(metadataBytes);
    const args = metadata["buildx.build.provenance"]?.invocation?.parameters?.args;
    assert.equal(args?.target, target);
    assert.equal(args[`label:${labelKey}`], id);
    assert.equal(args["label:com.unfreq.web-image-verification.source"], previous.sourceTreeSha256);
    assert.equal(args["label:org.opencontainers.image.revision"], previous.sourceCommit);
    assert.ok(typeof metadata["buildx.build.ref"] === "string" && metadata["buildx.build.ref"].startsWith(`unfreq-web-${id}/`));
    if (target === "runner") assert.equal(metadata["containerimage.digest"], previous.image?.id);
    const logBytes = await ordinaryFile(previousDirectory, `build-${target}.log`);
    assert.ok(logBytes.length > 0, "Prior successful build log is missing");
    buildMetadata.push({ target, metadataSha256: sha(metadataBytes), logSha256: sha(logBytes) });
  }
  assert.match(previous.image?.id ?? "", /^sha256:[a-f0-9]{64}$/u);
  const inspected = JSON.parse((await docker(["image", "inspect", previous.image.id])).stdout)[0];
  assert.equal(inspected.Id, previous.image.id);
  assert.equal(inspected.Config.Labels[labelKey], id);
  assert.equal(inspected.Config.Labels["com.unfreq.web-image-verification.source"], manifest.sourceTreeSha256);
  assert.equal(inspected.Config.Labels["org.opencontainers.image.revision"], previous.sourceCommit);
  assert.equal(inspected.Os, "linux");
  assert.equal(inspected.Architecture, "amd64");
  assert.deepEqual(inspected.Config.Cmd, ["npm", "--workspace", "@unfreq/web", "run", "start"]);
  assert.equal((await docker(["container", "ls", "--all", "--quiet", "--filter", `label=${labelKey}=${id}`])).stdout.trim(), "", "Prior runtime resources must be cleaned before resuming");
  assert.equal((await docker(["network", "ls", "--quiet", "--filter", `label=${labelKey}=${id}`])).stdout.trim(), "", "Prior runtime network must be cleaned before resuming");
  assert.equal((await docker(["container", "ls", "--all", "--quiet", "--filter", `name=^/buildx_buildkit_unfreq-web-${id}0$`])).stdout.trim(), "", "Prior builder container remains");
  assert.equal((await docker(["volume", "ls", "--quiet", "--filter", `name=^buildx_buildkit_unfreq-web-${id}0_state$`])).stdout.trim(), "", "Prior builder state volume remains");
  assert.equal((await docker(["volume", "ls", "--quiet", "--filter", `label=com.unfreq.web-image-builder.run=${id}`])).stdout.trim(), "", "Prior builder volume remains");
  manifest.image = { tag: previous.image.tag, id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture,
    repoDigests: inspected.RepoDigests, cmd: inspected.Config.Cmd, sizeBytes: inspected.Size };
  manifest.baseImage = previous.baseImage;
  manifest.runtimeOnly = true;
  manifest.buildReference = { runId: id, directory: previousDirectory, manifestSha256: sha(bytes), imageId: inspected.Id,
    sourceCommit: previous.sourceCommit, sourceTreeSha256: previous.sourceTreeSha256,
    dockerInputsVerified: Object.keys(previous.inputs).length, completedBuildStages: previous.buildStages,
    currentVerificationSources: verificationPaths.length, previousDeclaredVerificationSources: previousKeys.length,
    unchangedFixtureSources, previousCopiedFixturesVerified: fixturePaths.length,
    previousUncopiedSourcesChecked: "Current source bytes compared to prior recorded hashes; no claim of prior frozen copies.",
    verifierChanges, buildMetadata };
  console.log(`Resuming runtime of owned Web image ${inspected.Id}`);
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
  for (const relative of verificationPaths) {
    const bytes = await readFile(path.join(root, relative));
    fixtureBytes.set(relative, bytes);
    manifest.fixtureInputs[relative] = sha(bytes);
    const destination = path.join(directory, "verification", relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  console.log(`Linux Web image verification: ${runId}\nEvidence: ${directory}`);

  const allPaths = (await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
  const paths = [...new Set(allPaths)].filter((relative) =>
    [".dockerignore", "Dockerfile.web", "package.json", "package-lock.json", "apps/api/package.json", "scripts/apply-postgres-lifecycle-patch.mjs"].includes(relative) ||
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
  if (resumeMatch) {
    await resumeOwnedBuild(resumeMatch[1]);
  } else {
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
  // Building and browsing do not need to overlap. Release the private daemon
  // and its cache before starting native probes or host Chromium processes.
  assert.equal(await ownedBuilder.cleanup(), true, "Owned builder could not be released before runtime checks");
  }
  manifest.builderReleasedBeforeRuntime = true;
  await save();
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
    "--tmpfs", "/tmp:rw,nosuid,size=16m", "--mount", mount, "--entrypoint", "node", manifest.image.id, "/fixtures/web-image-probe.mjs"]);
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
  assert.ok(report.stats.expected >= 38);
  manifest.browsers = report.stats;
  manifest.playwrightVersion = JSON.parse(await readFile(path.join(root, "node_modules", "playwright", "package.json"), "utf8")).version;
  const identity = await runWithReferencedTimeout(async (signal) =>
    (await fetch(`http://127.0.0.1:${port}/__image/identity`, { signal, redirect: "error" })).json(), 1500);
  assert.equal(identity.blockedFetch, 0);
  manifest.blockedExternalFetch = identity.blockedFetch;
  await stopContainer(runtimeId, "runtime");
  for (const [relative, expected] of Object.entries({ ...manifest.inputs, ...manifest.fixtureInputs })) {
    assert.equal(sha(await readFile(path.join(root, relative))), expected, `Source changed during validation: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(manifest.inputs)) {
    assert.equal(sha(await readFile(path.join(frozen, relative))), expected, `Frozen build input changed: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(manifest.fixtureInputs)) {
    assert.equal(sha(await readFile(path.join(directory, "verification", relative))), expected, `Frozen verification source changed: ${relative}`);
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
      for (const id of ids) {
        const value = await inspectContainer(id);
        containers.add(value.Id);
      }
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
