import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const redisImage = "redis:7-alpine@sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af";
const runLabel = "dev.unfreq.recovery.run";
const scopeLabel = "dev.unfreq.recovery.scope";
const kindLabel = "dev.unfreq.recovery.kind";
const scope = "redis-aof";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cliReasons = new Set(["REDIS_CLI_SPAWN_FAILED", "REDIS_CLI_STDIN_FAILED", "REDIS_CLI_STDERR", "REDIS_CLI_OUTPUT_LIMIT",
  "REDIS_CLI_INVALID_JSON", "REDIS_CLI_SERVER_ERROR", "REDIS_CLI_UNEXPECTED_RESPONSE", "REDIS_CLI_COMMAND_TIMEOUT",
  "REDIS_CLI_PROCESS_EXITED", "REDIS_CLI_PROCESS_NOT_DRAINED", "REDIS_CLI_CLOSED", "REDIS_CLI_ARGUMENT_REJECTED"]);
const cliFailure = (code) => Object.assign(new Error("Recovery Redis CLI operation failed."), { code });

export const dockerTimeoutMs = (operation) => operation === "pull-fixed-image" ? 300_000 : 30_000;

export function isMissingImage(result) {
  return result.code !== 0 && /^\s*(?:Error(?: response from daemon)?:\s*)?No such image(?:\s|:|$)/imu.test(result.stderr);
}

export function safeFailure(error) {
  const reasons = new Map([
    ["Recovery Redis is not running.", "REDIS_NOT_RUNNING"],
    ["Refusing a non-loopback recovery Redis endpoint.", "REDIS_ENDPOINT_REJECTED"],
    ["Recovery Redis did not become ready.", "REDIS_NOT_READY"],
    ["Recovery Redis unexpectedly exposes a host port.", "REDIS_HOST_PORT_EXPOSED"],
    ["Recovery Redis network isolation changed.", "REDIS_NETWORK_REJECTED"],
    ["Fixed recovery image inspection failed.", "IMAGE_INSPECTION_FAILED"],
    ["Recovery requires a local Docker context.", "DOCKER_CONTEXT_REJECTED"],
    ["Recovery interrupted.", "INTERRUPTED"],
  ]);
  let errorReason = "UNEXPECTED_ERROR";
  if (error instanceof Error && cliReasons.has(error.code)) errorReason = error.code;
  else if (error instanceof assert.AssertionError) errorReason = "ASSERTION_FAILED";
  else if (error instanceof TypeError) errorReason = "TYPE_ERROR";
  else if (error instanceof SyntaxError) errorReason = "SYNTAX_ERROR";
  else if (error instanceof Error && reasons.has(error.message)) errorReason = reasons.get(error.message);
  else if (error instanceof Error && ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(error.code)) errorReason = "MODULE_IMPORT_MISSING";
  const stackFrames = [];
  // Never serialize the first line, arbitrary error text, external frames or
  // absolute user paths. Only locations inside this exact script are useful.
  if (error instanceof Error && typeof error.stack === "string") {
    const ownPath = fileURLToPath(import.meta.url).replaceAll("\\", "/");
    for (const frame of error.stack.split(/\r?\n/u).slice(1)) {
      const line = frame.trim().replaceAll("\\", "/");
      if (!line.startsWith("at ") || !(line.includes(import.meta.url + ":") || line.includes(ownPath + ":"))) continue;
      const position = /verify-redis-aof\.mjs:(\d+):(\d+)\)?$/u.exec(line);
      if (position) stackFrames.push(`verify-redis-aof.mjs:${position[1]}:${position[2]}`);
      if (stackFrames.length === 8) break;
    }
  }
  return { errorReason, stackFrames };
}

export function encodeRedisCliCommand(args) {
  const allowed = new Set(["PING", "CLIENT", "SET", "GET", "EVAL", "CONFIG", "HGET", "PTTL", "PEXPIRETIME", "WAITAOF", "QUIT"]);
  if (!Array.isArray(args) || args.length < 1 || args.length > 128 || !allowed.has(args[0]) ||
      args.some((arg) => typeof arg !== "string" && !(typeof arg === "number" && Number.isSafeInteger(arg))) ||
      args.some((arg) => typeof arg === "string" && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(arg))) {
    throw cliFailure("REDIS_CLI_ARGUMENT_REJECTED");
  }
  const command = args.map((arg) => JSON.stringify(String(arg))).join(" ") + "\n";
  if (Buffer.byteLength(command) > 262_144) throw cliFailure("REDIS_CLI_ARGUMENT_REJECTED");
  return command;
}

export function redisCliExecArguments(endpoint, container, runId) {
  if (!isLocalDockerEndpoint(endpoint) || !/^[a-f0-9]{12}$/u.test(runId) ||
      !/^[a-z0-9-]+$/u.test(container) || !container.startsWith(`unfreq-aof-${runId}-`)) {
    throw cliFailure("REDIS_CLI_ARGUMENT_REJECTED");
  }
  // --json otherwise automatically attempts RESP3, whose CONFIG GET reply is
  // a map. The runner's Redis-compatible interface explicitly uses RESP2.
  return ["--host", endpoint, "exec", "-i", container, "redis-cli", "-2", "--json"];
}

export function assertRedisIsolation(resource, networkName) {
  const bindings = Object.values(resource.HostConfig?.PortBindings ?? {});
  const exposed = Object.values(resource.NetworkSettings?.Ports ?? {});
  if (bindings.some((value) => Array.isArray(value) && value.length > 0) ||
      exposed.some((value) => Array.isArray(value) && value.length > 0)) throw new Error("Recovery Redis unexpectedly exposes a host port.");
  const networks = Object.keys(resource.NetworkSettings?.Networks ?? {});
  if (resource.HostConfig?.NetworkMode !== networkName || networks.length !== 1 || networks[0] !== networkName) {
    throw new Error("Recovery Redis network isolation changed.");
  }
}

// One process and one Redis connection per client lifecycle. QUIT is handled
// locally by non-TTY redis-cli, with no extra JSON reply; await its real exit.
export function createRedisCliSession(child, options = {}) {
  const commandTimeoutMs = options.commandTimeoutMs ?? 5_000;
  const exitTimeoutMs = options.exitTimeoutMs ?? 5_000;
  if (![commandTimeoutMs, exitTimeoutMs].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 5_000)) {
    throw cliFailure("REDIS_CLI_ARGUMENT_REJECTED");
  }
  const diagnostics = { pid: child.pid ?? null, sent: 0, received: 0, stdoutBytes: 0, stderrBytes: 0, closed: false,
    exitCode: null, signal: null, failureCode: null };
  const queue = [];
  let active;
  let closing = false;
  let failed;
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  function fail(code) {
    if (failed) return;
    failed = cliFailure(code); diagnostics.failureCode = code;
    if (active) { clearTimeout(active.timer); active.reject(failed); active = undefined; }
    for (const entry of queue.splice(0)) entry.reject(failed);
    child.stdin.destroy();
    if (!diagnostics.closed) child.kill("SIGKILL");
  }
  function pump() {
    if (failed || closing || active || !queue.length) return;
    active = queue.shift();
    active.timer = setTimeout(() => fail("REDIS_CLI_COMMAND_TIMEOUT"), commandTimeoutMs);
    diagnostics.sent += 1;
    child.stdin.write(active.command, (error) => { if (error) fail("REDIS_CLI_STDIN_FAILED"); });
  }
  child.stdout.on("data", (chunk) => {
    diagnostics.stdoutBytes += chunk.length;
    if (diagnostics.stdoutBytes > 1_048_576) { fail("REDIS_CLI_OUTPUT_LIMIT"); return; }
    buffer += decoder.write(chunk);
    let newline;
    while (!failed && (newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/u, ""); buffer = buffer.slice(newline + 1);
      if (!active) { fail("REDIS_CLI_UNEXPECTED_RESPONSE"); return; }
      let result;
      try { result = JSON.parse(line); } catch { fail("REDIS_CLI_INVALID_JSON"); return; }
      if (result !== null && typeof result === "object" && !Array.isArray(result) && "error" in result) {
        fail("REDIS_CLI_SERVER_ERROR"); return;
      }
      const entry = active; active = undefined; clearTimeout(entry.timer);
      diagnostics.received += 1; entry.resolve(result); pump();
    }
  });
  child.stderr.on("data", (chunk) => {
    diagnostics.stderrBytes += chunk.length;
    fail(diagnostics.stderrBytes > 65_536 ? "REDIS_CLI_OUTPUT_LIMIT" : "REDIS_CLI_STDERR");
  });
  child.stdin.on("error", () => fail("REDIS_CLI_STDIN_FAILED"));
  child.once("error", () => fail("REDIS_CLI_SPAWN_FAILED"));
  child.once("close", (code, signal) => {
    buffer += decoder.end();
    diagnostics.closed = true; diagnostics.exitCode = Number.isInteger(code) ? code : null; diagnostics.signal = signal;
    if ((!closing || code !== 0 || active || queue.length || buffer.length) && !failed) fail("REDIS_CLI_PROCESS_EXITED");
    resolveClosed();
  });
  async function awaitClosed() {
    let timer;
    try {
      await Promise.race([closed, new Promise((_, reject) => {
        timer = setTimeout(() => { child.kill("SIGKILL"); reject(cliFailure("REDIS_CLI_PROCESS_NOT_DRAINED")); }, exitTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  const call = async (...args) => {
    options.beforeCommand?.();
    if (failed) throw failed;
    if (closing || diagnostics.closed) throw cliFailure("REDIS_CLI_CLOSED");
    const command = encodeRedisCliCommand(args);
    if (queue.length >= 64) throw cliFailure("REDIS_CLI_ARGUMENT_REJECTED");
    return new Promise((resolve, reject) => { queue.push({ command, resolve, reject }); pump(); });
  };
  return {
    diagnostics, call,
    ping: () => call("PING"), set: (...args) => call("SET", ...args), get: (...args) => call("GET", ...args),
    eval: (...args) => call("EVAL", ...args), config: (...args) => call("CONFIG", ...args),
    hget: (...args) => call("HGET", ...args), pttl: (...args) => call("PTTL", ...args),
    async quit() {
      if (failed) { await awaitClosed(); throw failed; }
      if (active || queue.length || closing) throw cliFailure("REDIS_CLI_CLOSED");
      closing = true; child.stdin.end(encodeRedisCliCommand(["QUIT"]));
      await awaitClosed();
      if (failed || diagnostics.exitCode !== 0) throw failed ?? cliFailure("REDIS_CLI_PROCESS_EXITED");
      return "OK";
    },
    async disconnect() {
      if (!diagnostics.closed) { closing = true; fail("REDIS_CLI_CLOSED"); }
      await awaitClosed();
    },
  };
}

export function parseArguments(args) {
  if (args.length === 0) return { help: false };
  if (args.length === 1 && args[0] === "--help") return { help: true };
  throw new Error("This recovery runner accepts no URLs, resource names, paths or overrides; only --help is supported.");
}

export function isLocalDockerEndpoint(endpoint) {
  return typeof endpoint === "string" && (/^npipe:\/{4}\.\/pipe\/[a-z0-9_.-]+$/iu.test(endpoint) ||
    /^unix:\/\/\/[^/?#\0][^?#\0]*$/u.test(endpoint));
}

// Read these exact production Lua literals without importing env, app or DB
// modules. Unknown interpolation/JS escaping fails closed instead of eval().
export function extractLua(source, name, substitutions = {}) {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/u.test(name)) throw new Error("Invalid Lua literal name.");
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const declaration = `const ${name} = \``;
  const offset = normalized.indexOf(declaration);
  if (offset < 0 || normalized.indexOf(declaration, offset + 1) !== -1) throw new Error("Production Lua declaration changed.");
  const begin = offset + declaration.length;
  const end = normalized.indexOf("`;", begin);
  if (end < 0) throw new Error("Production Lua terminator changed.");
  let lua = normalized.slice(begin, end);
  if (lua.includes("`") || lua.includes("\\")) throw new Error("Production Lua escaping needs explicit review.");
  for (const [key, value] of Object.entries(substitutions)) lua = lua.replaceAll(`\${${key}}`, value);
  if (lua.includes("${")) throw new Error("Unrecognized production Lua interpolation.");
  return lua;
}

export function assertOwnedResource(kind, resource, expected) {
  if (!["container", "volume", "network"].includes(kind) || !/^[a-f0-9]{12}$/u.test(expected.runId) ||
      !/^[a-z0-9-]+$/u.test(expected.name)) throw new Error("Invalid recovery ownership request.");
  const name = kind === "container" ? resource.Name?.replace(/^\//u, "") : resource.Name;
  const labels = kind === "container" ? resource.Config?.Labels : resource.Labels;
  if (name !== expected.name || !name.startsWith(`unfreq-aof-${expected.runId}-`) ||
      labels?.[runLabel] !== expected.runId || labels?.[scopeLabel] !== scope || labels?.[kindLabel] !== kind) {
    throw new Error("Refusing an unowned recovery resource.");
  }
  if (kind === "container" && resource.Config?.Image !== redisImage) throw new Error("Recovery container image changed.");
  if (kind === "network" && resource.Internal !== true) throw new Error("Recovery network is not internal.");
}

export function parseAofInventory(output) {
  const files = output.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const matched = /^([a-f0-9]{64})\s+(\d+)\s+\.\/(appendonlydir\/[a-zA-Z0-9_.-]+)$/u.exec(line);
    if (!matched || !Number.isSafeInteger(Number(matched[2])) ||
        !/^appendonlydir\/appendonly\.aof\.(?:manifest|[1-9]\d*\.(?:base|incr)\.(?:aof|rdb))$/u.test(matched[3])) {
      throw new Error("Unexpected AOF inventory output.");
    }
    return { path: matched[3], bytes: Number(matched[2]), sha256: matched[1] };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length || !files.some((file) => file.path.endsWith(".manifest")) ||
      !files.some((file) => file.path.endsWith(".incr.aof"))) {
    throw new Error("AOF checkpoint is missing its multipart manifest or incremental log.");
  }
  return files;
}

function safeEnvironment() {
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
    "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE",
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_CLI_PLUGIN_EXTRA_DIRS"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())).map(([key, value]) => [key.toUpperCase(), value]));
}

const inventoryShell = `set -eu
cd /from
test -f appendonlydir/appendonly.aof.manifest
find . -type f | sort | while IFS= read -r file; do
  sum=$(sha256sum "$file"); sum=\${sum%% *}
  size=$(wc -c < "$file")
  printf '%s %s %s\\n' "$sum" "$size" "$file"
done`;
const copyShell = `set -eu
test -f /from/appendonlydir/appendonly.aof.manifest
test -z "$(find /to -mindepth 1 -maxdepth 1 -print -quit)"
cp -a /from/. /to/`;
const truncateShell = `set -eu
cd /data/appendonlydir
file=$(awk '$1 == "file" && $6 == "i" {print $2}' appendonly.aof.manifest | tail -n 1)
case "$file" in appendonly.aof.*.incr.aof) ;; *) exit 41 ;; esac
test -f "$file"
size=$(wc -c < "$file")
test "$size" -gt 1
truncate -s "$((size - 1))" "$file"`;

export async function verifyRedisAof() {
  const env = safeEnvironment();
  if (env.DOCKER_HOST && !isLocalDockerEndpoint(env.DOCKER_HOST)) throw new Error("Remote Docker hosts are not allowed for recovery tests.");
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const prefix = `unfreq-aof-${runId}`;
  const directory = path.join(root, "test-results", "redis-aof", `run-${runId}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = { schemaVersion: 1, syntheticOnly: true, scope, runId, startedAt: new Date().toISOString(),
    image: redisImage, platform: "linux/amd64", inputs: {}, resources: { container: [], volume: [], network: [] },
    commands: [], checks: [], observations: {}, clientSessions: [], limitations: [
      "Production Lua and Redis persistence only; not an API, PostgreSQL, session-signing or deployment recovery.",
      "An older checkpoint can revive an unexpired consumed challenge and roll back spent budget.",
      "appendfsync=always and acknowledged checkpoints do not prove arbitrary power-loss RPO=0 or production latency.",
      "Strict truncated-AOF rejection is tested with aof-load-truncated=no; production defaults are not changed.",
    ] };
  const names = { container: new Set(), volume: new Set(), network: new Set() };
  const clients = new Set();
  let stage = "preflight";
  let activeChild;
  let pinnedEndpoint;
  let interrupted = false;
  let cleaning = false;
  let helperNumber = 0;
  let passed = false;
  const onInterrupt = () => { interrupted = true; if (!cleaning) activeChild?.kill("SIGTERM"); };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  const persist = () => writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const labels = (kind) => ["--label", `${runLabel}=${runId}`, "--label", `${scopeLabel}=${scope}`, "--label", `${kindLabel}=${kind}`];
  const remember = (kind, role) => {
    const name = `${prefix}-${role}`;
    if (!/^[a-z0-9-]+$/u.test(name)) throw new Error("Invalid generated recovery name.");
    names[kind].add(name); manifest.resources[kind].push(name); return name;
  };
  async function docker(operation, args, { allowFailure = false } = {}) {
    if (interrupted && !cleaning) throw new Error("Recovery interrupted.");
    const started = performance.now();
    const timeoutMs = dockerTimeoutMs(operation);
    return new Promise((resolve, reject) => {
      const childEnv = { ...env };
      if (pinnedEndpoint !== undefined) { delete childEnv.DOCKER_CONTEXT; delete childEnv.DOCKER_HOST; }
      const child = spawn("docker", pinnedEndpoint === undefined ? args : ["--host", pinnedEndpoint, ...args], {
        cwd: root, env: childEnv, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      activeChild = child;
      let stdout = ""; let stderr = ""; let timedOut = false; let oversized = false;
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
      const capture = (which, chunk) => {
        if (stdout.length + stderr.length + chunk.length > 1_048_576) { oversized = true; child.kill("SIGKILL"); return; }
        if (which === "out") stdout += chunk; else stderr += chunk;
      };
      child.stdout.on("data", (chunk) => capture("out", chunk));
      child.stderr.on("data", (chunk) => capture("err", chunk));
      child.once("error", () => { clearTimeout(timer); reject(new Error(`Docker ${operation} could not start.`)); });
      child.once("close", (code, signal) => {
        clearTimeout(timer); if (activeChild === child) activeChild = undefined;
        const result = { code: code ?? 1, signal, stdout, stderr };
        manifest.commands.push({ operation, code: result.code, signal, timeoutMs, timedOut, oversized,
          stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), elapsedMs: Math.round(performance.now() - started) });
        if (timedOut || oversized || (!allowFailure && result.code !== 0)) reject(new Error(`Docker ${operation} failed.`));
        else resolve(result);
      });
    });
  }
  async function inspect(kind, name) {
    if (!names[kind].has(name)) throw new Error("Recovery target was not generated by this run.");
    const args = kind === "container" ? ["inspect", name] : [kind, "inspect", name];
    const resource = JSON.parse((await docker(`inspect-${kind}`, args)).stdout)[0];
    assertOwnedResource(kind, resource, { runId, name });
    return resource;
  }
  async function volume(role) {
    const name = remember("volume", role);
    await persist();
    const existing = (await docker("list-before-volume", ["volume", "ls", "--format", "{{.Name}}", "--filter", `name=${name}`])).stdout.trim().split(/\s+/u);
    if (existing.includes(name)) throw new Error("Refusing an existing recovery volume.");
    await docker("create-volume", ["volume", "create", ...labels("volume"), name]);
    await inspect("volume", name); return name;
  }
  async function helper(mounts, shell) {
    const name = remember("container", `helper-${++helperNumber}`);
    await persist();
    for (const mount of mounts) await inspect("volume", mount.name);
    await docker("create-helper", ["create", "--name", name, ...labels("container"), "--network", "none",
      ...mounts.flatMap((mount) => ["--mount", `type=volume,source=${mount.name},target=${mount.target}${mount.readonly ? ",readonly" : ""}`]),
      redisImage, "sh", "-c", shell]);
    await inspect("container", name);
    const result = await docker("run-helper", ["start", "--attach", name]);
    const ended = await inspect("container", name);
    if (ended.State.Running || ended.State.ExitCode !== 0) throw new Error("Recovery helper did not complete.");
    return result.stdout;
  }
  const inventory = async (name) => parseAofInventory(await helper([{ name, target: "/from", readonly: true }], inventoryShell));
  async function copy(from, to) {
    await helper([{ name: from, target: "/from", readonly: true }, { name: to, target: "/to", readonly: false }], copyShell);
    const [source, target] = [await inventory(from), await inventory(to)];
    assert.deepEqual(target, source); return target;
  }
  async function createRedis(role, data, network) {
    const name = remember("container", role);
    await persist();
    await inspect("volume", data); await inspect("network", network);
    await docker("create-redis", ["create", "--name", name, ...labels("container"), "--network", network,
      "--restart", "no", "--mount", `type=volume,source=${data},target=/data`,
      redisImage, "redis-server", "--save", "", "--appendonly", "yes", "--appendfsync", "always",
      "--aof-use-rdb-preamble", "no", "--aof-load-truncated", "no", "--auto-aof-rewrite-percentage", "0"]);
    assertRedisIsolation(await inspect("container", name), network); return name;
  }
  async function connect(name) {
    const connectionStage = stage;
    stage = `${connectionStage}:inspect`;
    const checked = await inspect("container", name);
    if (!checked.State.Running) throw new Error("Recovery Redis is not running.");
    stage = `${connectionStage}:isolation`;
    const network = [...names.network][0];
    await inspect("network", network); assertRedisIsolation(checked, network);
    stage = `${connectionStage}:ping`;
    const deadline = performance.now() + 15_000;
    do {
      const childEnv = { ...env }; delete childEnv.DOCKER_CONTEXT; delete childEnv.DOCKER_HOST;
      const child = spawn("docker", redisCliExecArguments(pinnedEndpoint, name, runId), {
        cwd: root, env: childEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      const client = createRedisCliSession(child, { beforeCommand() { if (interrupted && !cleaning) throw new Error("Recovery interrupted."); } });
      clients.add(client);
      // Keep the same object in the report while the real process is drained.
      manifest.clientSessions.push(Object.assign(client.diagnostics, { container: name }));
      try {
        assert.equal(await client.ping(), "PONG");
        client.initialClientId = Number(await client.call("CLIENT", "ID"));
        assert.ok(Number.isSafeInteger(client.initialClientId) && client.initialClientId > 0);
        client.diagnostics.initialClientId = client.initialClientId;
        stage = connectionStage; return client;
      } catch {
        await client.disconnect(); clients.delete(client); await sleep(100);
      }
    } while (performance.now() < deadline);
    throw new Error("Recovery Redis did not become ready.");
  }
  async function start(name) {
    const phase = stage;
    stage = `${phase}:start`;
    await inspect("container", name); await docker("start-redis", ["start", name]);
    stage = `${phase}:connect`;
    const client = await connect(name); stage = phase; return client;
  }
  async function stop(name, client) {
    await client.quit(); clients.delete(client);
    await inspect("container", name); await docker("stop-redis", ["stop", "--time", "10", name]);
    const stopped = await inspect("container", name);
    if (stopped.State.Running || stopped.State.ExitCode !== 0) throw new Error("Recovery Redis did not stop cleanly.");
  }
  const check = (name, condition, observations = {}) => {
    manifest.checks.push({ name, passed: condition, ...observations });
    if (!condition) throw new Error(`Recovery check ${name} failed.`);
  };
  const barrier = async (client) => {
    // WAITAOF is meaningful only on the same persistent connection that wrote.
    const beforeClientId = Number(await client.call("CLIENT", "ID"));
    assert.equal(beforeClientId, client.initialClientId);
    const result = await client.call("WAITAOF", "1", "0", "5000");
    assert.deepEqual(result, [1, 0]);
    const afterClientId = Number(await client.call("CLIENT", "ID"));
    assert.equal(afterClientId, client.initialClientId);
    manifest.observations.barriers ??= [];
    manifest.observations.barriers.push({ container: client.diagnostics.container, atSessionStart: client.initialClientId,
      beforeWaitAof: beforeClientId, afterWaitAof: afterClientId, localFsyncAck: result[0], replicaFsyncAck: result[1] });
    return result;
  };
  async function captureStartupDiagnostics() {
    manifest.startupDiagnostics = [];
    if (pinnedEndpoint === undefined) return;
    for (const name of [...names.container].filter((value) => !value.includes("-helper-")).slice(0, 4)) {
      try {
        const owned = await inspect("container", name);
        const logs = await docker("failure-startup-logs", ["logs", "--tail", "100", name], { allowFailure: true });
        const bytes = Buffer.from(logs.stdout + logs.stderr);
        const limited = bytes.subarray(0, 65_536);
        const logFile = `${name}-startup.log`;
        await writeFile(path.join(directory, logFile), limited, { mode: 0o600 });
        const command = owned.Config?.Cmd;
        const saveIndex = Array.isArray(command) ? command.indexOf("--save") : -1;
        manifest.startupDiagnostics.push({ name, running: owned.State?.Running === true,
          exitCode: Number.isInteger(owned.State?.ExitCode) ? owned.State.ExitCode : null,
          status: ["created", "running", "paused", "restarting", "removing", "exited", "dead"].includes(owned.State?.Status) ? owned.State.Status : "OTHER",
          emptySaveArgumentPresent: saveIndex >= 0 && command[saveIndex + 1] === "",
          logFile, logBytes: limited.length, logSha256: digest(limited), truncated: bytes.length > limited.length });
      } catch { manifest.startupDiagnostics.push({ name, available: false, code: "OWNED_STARTUP_DIAGNOSTIC_UNAVAILABLE" }); }
    }
  }
  async function cleanup() {
    cleaning = true;
    const failures = [];
    for (const client of clients) { try { await client.disconnect(); } catch { failures.push("REDIS_CLI_PROCESS_NOT_DRAINED"); } }
    clients.clear();
    for (const kind of ["container", "volume", "network"]) {
      try {
        const args = kind === "container" ? ["ps", "--all", "--format", "{{.Names}}", "--filter", `label=${runLabel}=${runId}`]
          : [kind, "ls", "--format", "{{.Name}}", "--filter", `label=${runLabel}=${runId}`];
        const listed = (await docker(`cleanup-list-${kind}`, args)).stdout.trim().split(/\s+/u).filter(Boolean);
        for (const name of listed) {
          try {
            await inspect(kind, name);
            await docker(`cleanup-remove-${kind}`, kind === "container" ? ["rm", "--force", name] : [kind, "rm", name]);
          } catch { failures.push(`REMOVE_${kind.toUpperCase()}`); }
        }
        if ((await docker(`cleanup-verify-${kind}`, args)).stdout.trim()) failures.push(`REMAINING_${kind.toUpperCase()}`);
      } catch { failures.push(`LIST_${kind.toUpperCase()}`); }
    }
    manifest.cleanup = { passed: failures.length === 0, failures };
  }

  try {
    await persist(); console.log(`Redis AOF evidence: ${directory}`);
    const contextName = (await docker("context-show", ["context", "show"])).stdout.trim();
    const context = JSON.parse((await docker("context-inspect", ["context", "inspect", contextName])).stdout)[0];
    if (!isLocalDockerEndpoint(context?.Endpoints?.docker?.Host)) throw new Error("Recovery requires a local Docker context.");
    // Pin the verified local endpoint for every later command; changing the
    // user's default Docker context mid-run cannot redirect mutations/cleanup.
    pinnedEndpoint = context.Endpoints.docker.Host;
    manifest.engineVersion = (await docker("engine-version", ["info", "--format", "{{.ServerVersion}}"])).stdout.trim();
    await docker("image-present", ["image", "inspect", redisImage], { allowFailure: true }).then(async (result) => {
      if (isMissingImage(result)) await docker("pull-fixed-image", ["pull", "--platform", "linux/amd64", redisImage]);
      else if (result.code !== 0) throw new Error("Fixed recovery image inspection failed.");
    });
    const image = JSON.parse((await docker("image-inspect", ["image", "inspect", redisImage])).stdout)[0];
    if (image.Os !== "linux" || image.Architecture !== "amd64") throw new Error("Recovery needs the fixed linux/amd64 Redis image.");
    manifest.imageId = image.Id; manifest.repoDigests = image.RepoDigests;
    const sourcePaths = ["apps/api/src/shared/abuse-control.ts", "apps/api/src/modules/auth/service.ts", "scripts/verify-redis-aof.mjs"];
    for (const relative of sourcePaths) manifest.inputs[relative] = digest(await readFile(path.join(root, relative)));
    const quotaSource = await readFile(path.join(root, sourcePaths[0]), "utf8");
    const authSource = await readFile(path.join(root, sourcePaths[1]), "utf8");
    const quota = extractLua(quotaSource, "quotaScript", { redisClock: extractLua(quotaSource, "redisClock") });
    const verify = extractLua(authSource, "verifyChallengeScript");
    manifest.productionLua = { quotaSha256: digest(quota), verifyChallengeSha256: digest(verify) };
    stage = "resource-creation";
    const network = remember("network", "network");
    await persist();
    await docker("create-internal-network", ["network", "create", "--internal", ...labels("network"), network]);
    await inspect("network", network);
    const sourceVolume = await volume("source-data"); const oldVolume = await volume("old-checkpoint");
    const targetVolume = await volume("restored-data"); const staleVolume = await volume("stale-data"); const corruptVolume = await volume("corrupt-data");
    const source = await createRedis("source", sourceVolume, network);
    let client = await start(source);
    stage = "source-config";
    const configuration = await client.config("GET", "appendonly", "appendfsync", "aof-load-truncated", "aof-use-rdb-preamble", "save");
    const config = Object.fromEntries(Array.from({ length: configuration.length / 2 }, (_, i) => [configuration[i * 2], configuration[i * 2 + 1]]));
    check("explicit-durability-configuration", config.appendonly === "yes" && config.appendfsync === "always" &&
      config["aof-load-truncated"] === "no" && config["aof-use-rdb-preamble"] === "no" && config.save === "");
    const challengeKey = "unfreq:aof:synthetic:challenge"; const cooldownKey = "unfreq:aof:synthetic:cooldown";
    const quotaKey = "unfreq:aof:synthetic:quota"; const ttlKey = "unfreq:aof:synthetic:ttl";
    const expiredKey = "unfreq:aof:synthetic:expired"; const markerKey = "unfreq:aof:synthetic:marker";
    const afterKey = "unfreq:aof:synthetic:after-checkpoint";
    const identity = "synthetic-account"; const codeHash = "synthetic-code-digest";
    const charge = (units) => [{ rule: "chatCallsSite", units, limit: 3, windowMs: 86_400_000 }];
    const quotaCall = (connection, units) => connection.eval(quota, 1, quotaKey, "consume", JSON.stringify(charge(units)));
    const verifyCall = (connection, code = codeHash) => connection.eval(verify, 2, challengeKey, cooldownKey, identity, code, 5);
    stage = "older-checkpoint";
    await client.set(markerKey, "before-checkpoint");
    await client.set(challengeKey, JSON.stringify({ email: identity, codeHash, attemptCount: 0 }), "PX", 1_200_000);
    await client.set(ttlKey, "synthetic-ttl", "PX", 1_200_000);
    const challengeExpiry = Number(await client.call("PEXPIRETIME", challengeKey));
    const ttlExpiry = Number(await client.call("PEXPIRETIME", ttlKey));
    const initialQuota = await quotaCall(client, 1);
    check("synthetic-budget-window-has-headroom", initialQuota[0] === 1 && initialQuota[2] > 300_000);
    check("wrong-challenge-keeps-absolute-expiry", (await verifyCall(client, "wrong-synthetic-digest"))[0] === 0 &&
      Number(await client.call("PEXPIRETIME", challengeKey)) === challengeExpiry);
    manifest.observations.initialQuotaUsed = Number(await client.hget(quotaKey, "used"));
    manifest.observations.absoluteExpiry = { challenge: challengeExpiry, ttl: ttlExpiry };
    await barrier(client); await stop(source, client);
    manifest.olderCheckpointFiles = await copy(sourceVolume, oldVolume);
    check("stopped-checkpoint-byte-copy", manifest.olderCheckpointFiles.length >= 2);
    stage = "current-checkpoint";
    client = await start(source);
    check("source-restart-preserves-absolute-ttl", Number(await client.call("PEXPIRETIME", ttlKey)) === ttlExpiry);
    check("consume-production-once-lua", (await verifyCall(client))[0] === 1 && (await verifyCall(client))[0] === -1);
    check("shared-budget-charged-and-denied", (await quotaCall(client, 2))[0] === 1 && (await quotaCall(client, 1))[0] === 0 &&
      Number(await client.hget(quotaKey, "used")) === 3);
    await client.set(markerKey, "after-checkpoint"); await client.set(afterKey, "synthetic-post-checkpoint");
    await client.set(expiredKey, "synthetic-short-ttl", "PX", 1200);
    manifest.observations.shortAbsoluteExpiry = Number(await client.call("PEXPIRETIME", expiredKey));
    manifest.observations.currentBarrier = await barrier(client);
    await stop(source, client); await sleep(1300);
    manifest.currentCheckpointFiles = await copy(sourceVolume, targetVolume);
    await copy(sourceVolume, corruptVolume); await copy(oldVolume, staleVolume);
    stage = "current-restore";
    const restored = await createRedis("restored", targetVolume, network);
    const restoredClient = await start(restored);
    check("current-checkpoint-restores-marker", await restoredClient.get(markerKey) === "after-checkpoint" && await restoredClient.get(afterKey) === "synthetic-post-checkpoint");
    check("restore-does-not-extend-absolute-ttl", Number(await restoredClient.call("PEXPIRETIME", ttlKey)) === ttlExpiry && Number(await restoredClient.pttl(ttlKey)) > 0);
    check("elapsed-ttl-is-not-revived", await restoredClient.get(expiredKey) === null);
    check("consumed-challenge-is-not-revived", await restoredClient.get(challengeKey) === null && (await verifyCall(restoredClient))[0] === -1);
    check("restored-shared-budget-not-reset", Number(await restoredClient.hget(quotaKey, "used")) === 3 && (await quotaCall(restoredClient, 1))[0] === 0);
    await stop(restored, restoredClient);
    stage = "stale-checkpoint-counterexample";
    const stale = await createRedis("stale", staleVolume, network);
    const staleClient = await start(stale);
    check("older-checkpoint-loses-newer-writes", await staleClient.get(markerKey) === "before-checkpoint" && await staleClient.get(afterKey) === null);
    check("older-checkpoint-revives-unexpired-challenge", await staleClient.get(challengeKey) !== null &&
      Number(await staleClient.call("PEXPIRETIME", challengeKey)) === challengeExpiry && (await verifyCall(staleClient))[0] === 1);
    check("older-checkpoint-rolls-back-spent-budget", Number(await staleClient.hget(quotaKey, "used")) === 1 && (await quotaCall(staleClient, 2))[0] === 1);
    await stop(stale, staleClient);
    stage = "strict-corrupt-aof";
    await helper([{ name: corruptVolume, target: "/data", readonly: false }], truncateShell);
    const corruptFiles = await inventory(corruptVolume);
    const changed = corruptFiles.filter((file) => manifest.currentCheckpointFiles.find((old) => old.path === file.path)?.sha256 !== file.sha256);
    check("corruption-is-one-byte-in-one-increment", changed.length === 1 && changed[0].path.endsWith(".incr.aof") &&
      manifest.currentCheckpointFiles.find((file) => file.path === changed[0].path)?.bytes === changed[0].bytes + 1);
    manifest.corruptCheckpointFiles = corruptFiles;
    const corrupt = await createRedis("corrupt", corruptVolume, network);
    await docker("start-corrupt-redis", ["start", corrupt]);
    const exitDeadline = performance.now() + 10_000;
    let corruptState = await inspect("container", corrupt);
    while (corruptState.State.Running && performance.now() < exitDeadline) { await sleep(100); corruptState = await inspect("container", corrupt); }
    const corruptLogResult = await docker("corrupt-startup-logs", ["logs", corrupt]);
    const corruptLogs = corruptLogResult.stdout + corruptLogResult.stderr;
    await writeFile(path.join(directory, "corrupt-startup.log"), corruptLogs, { mode: 0o600 });
    check("strict-truncated-aof-refuses-startup", !corruptState.State.Running && corruptState.State.ExitCode !== 0 &&
      /Unexpected end of file|Bad file format|short read|AOF.*truncat/iu.test(corruptLogs));
    manifest.observations.corruptExitCode = corruptState.State.ExitCode;
    stage = "source-verification";
    for (const [relative, expected] of Object.entries(manifest.inputs)) assert.equal(digest(await readFile(path.join(root, relative))), expected);
    check("source-inputs-stable", true);
    check("all-client-processes-drained", manifest.clientSessions.length >= 4 && manifest.clientSessions.every((session) => session.closed));
    passed = true;
  } catch (error) {
    manifest.failure = { stage, code: interrupted ? "INTERRUPTED" : "RECOVERY_VERIFICATION_FAILED", ...safeFailure(error) };
    await persist();
    await captureStartupDiagnostics();
  } finally {
    // A rejected default context must never be queried again during cleanup.
    // No engine operation or resource creation precedes the endpoint pin.
    if (pinnedEndpoint === undefined) manifest.cleanup = { passed: true, skippedBeforeResourceCreation: true, failures: [] };
    else await cleanup();
    manifest.finishedAt = new Date().toISOString(); manifest.interrupted = interrupted;
    manifest.passed = passed && manifest.cleanup.passed && !interrupted;
    await persist(); process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onInterrupt);
  }
  if (!manifest.passed) throw new Error(`Redis AOF verification failed at ${manifest.failure?.stage ?? "cleanup"}. Evidence: ${directory}`);
  console.log(`Redis AOF checks: ${manifest.checks.length}/${manifest.checks.length}; owned resources cleaned.`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) console.log("Usage: node scripts/verify-redis-aof.mjs\nRuns an isolated, synthetic, local-Docker Redis AOF recovery drill. No resource or endpoint overrides are accepted.");
    else await verifyRedisAof();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Redis AOF verification failed."); process.exitCode = 1;
  }
}
