import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PassThrough } from "node:stream";
import { assertOwnedResource, extractLua, isLocalDockerEndpoint, parseAofInventory, parseArguments,
  redisImage, dockerTimeoutMs, isMissingImage, safeFailure, encodeRedisCliCommand, assertRedisIsolation,
  createRedisCliSession, redisCliExecArguments } from "../../scripts/verify-redis-aof.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const runner = path.join(root, "scripts", "verify-redis-aof.mjs");
const runId = "a123456789bc";
const name = `unfreq-aof-${runId}-source`;
const expected = { runId, name };
const labels = (kind) => ({ "dev.unfreq.recovery.run": runId, "dev.unfreq.recovery.scope": "redis-aof",
  "dev.unfreq.recovery.kind": kind });

test("the recovery CLI accepts no caller-owned resource, destination or endpoint", () => {
  assert.deepEqual(parseArguments([]), { help: false });
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  for (const args of [["--redis-url=redis://127.0.0.1:6379"], ["--volume=unfreq_redis-data"], ["--container=redis"],
    ["--output=elsewhere"], ["--image=redis:latest"], ["--help", "--volume=production"], ["existing-container"]]) {
    assert.throws(() => parseArguments(args), /accepts no URLs/);
  }
});

test("Docker endpoint locality rejects TCP, SSH and remote named pipes", () => {
  for (const endpoint of ["npipe:////./pipe/dockerDesktopLinuxEngine", "unix:///var/run/docker.sock"]) {
    assert.equal(isLocalDockerEndpoint(endpoint), true);
  }
  for (const endpoint of [undefined, null, "", "tcp://127.0.0.1:2375", "ssh://local", "https://localhost:443",
    "npipe:////server/pipe/docker_engine", "npipe:////127.0.0.1/pipe/docker_engine", "unix://remote/var/run/docker.sock",
    "npipe:////./pipe/../../other", "unix:///var/run/docker.sock?remote=1"]) {
    assert.equal(isLocalDockerEndpoint(endpoint), false);
  }
});

test("only an explicitly missing image is downloaded with its separate bounded preparation budget", () => {
  assert.equal(dockerTimeoutMs("pull-fixed-image"), 300_000);
  for (const operation of ["image-present", "create-redis", "start-redis", "inspect-container", "cleanup-remove-volume"]) {
    assert.equal(dockerTimeoutMs(operation), 30_000);
  }
  assert.equal(isMissingImage({ code: 1, stderr: "Error: No such image: redis@sha256:synthetic\n" }), true);
  assert.equal(isMissingImage({ code: 1, stderr: "Error response from daemon: No such image: redis@sha256:synthetic\n" }), true);
  for (const result of [{ code: 0, stderr: "No such image" }, { code: 1, stderr: "permission denied" },
    { code: 1, stderr: "Cannot connect to the Docker daemon" }, { code: 1, stderr: "unknown network failure" }]) {
    assert.equal(isMissingImage(result), false);
  }
});

test("failure diagnostics retain only fixed reasons and locations in this exact recovery script", () => {
  const error = new Error("SYNTHETIC_SECRET_BODY");
  const ownUrl = new URL("../../scripts/verify-redis-aof.mjs", import.meta.url).href;
  error.stack = `Error: SYNTHETIC_SECRET_BODY\n    at connect (${ownUrl}:9:12)\n    at outside (file:///elsewhere/verify-redis-aof.mjs:1:2)\n    at module (file:///ioredis/index.js:3:4)`;
  assert.deepEqual(safeFailure(error), { errorReason: "UNEXPECTED_ERROR", stackFrames: ["verify-redis-aof.mjs:9:12"] });
  assert.doesNotMatch(JSON.stringify(safeFailure(error)), /SECRET_BODY|elsewhere|ioredis|file:\/\//u);
  assert.equal(safeFailure(new Error("Recovery Redis is not running.")).errorReason, "REDIS_NOT_RUNNING");
  assert.equal(safeFailure(Object.assign(new Error("SECRET"), { code: "ERR_MODULE_NOT_FOUND" })).errorReason, "MODULE_IMPORT_MISSING");
});

test("native child-process argv preserves the empty Redis save argument", () => {
  const args = ["redis-server", "--save", "", "--appendonly", "yes"];
  const result = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "--", ...args], {
    cwd: root, windowsHide: true, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("Redis instances require the internal network and expose no host port, including loopback", () => {
  const network = `unfreq-aof-${runId}-network`;
  const isolated = { HostConfig: { NetworkMode: network, PortBindings: {} },
    NetworkSettings: { Networks: { [network]: {} }, Ports: { "6379/tcp": null } } };
  assert.doesNotThrow(() => assertRedisIsolation(isolated, network));
  assert.throws(() => assertRedisIsolation({ ...isolated, HostConfig: { ...isolated.HostConfig,
    PortBindings: { "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "12345" }] } } }, network), /exposes a host port/);
  assert.throws(() => assertRedisIsolation({ ...isolated, NetworkSettings: { ...isolated.NetworkSettings,
    Ports: { "6379/tcp": [{ HostIp: "0.0.0.0", HostPort: "12345" }] } } }, network), /exposes a host port/);
  assert.throws(() => assertRedisIsolation({ ...isolated, HostConfig: { NetworkMode: "host" } }, network), /isolation changed/);
  assert.throws(() => assertRedisIsolation({ ...isolated, NetworkSettings: { Networks: { foreign: {} } } }, network), /isolation changed/);
});

test("the persistent exec protocol fixes RESP2 JSON, stdin without TTY, and an owned local target", () => {
  const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
  const args = redisCliExecArguments(endpoint, name, runId);
  assert.deepEqual(args, ["--host", endpoint, "exec", "-i", name, "redis-cli", "-2", "--json"]);
  assert.equal(args.includes("-3"), false); assert.equal(args.includes("-t"), false);
  for (const [host, target, run] of [["tcp://127.0.0.1:2375", name, runId], [endpoint, "production-redis", runId],
    [endpoint, name + " --privileged", runId], [endpoint, name, "b123456789bc"]]) {
    assert.throws(() => redisCliExecArguments(host, target, run), { code: "REDIS_CLI_ARGUMENT_REJECTED" });
  }
});

test("stdin command encoding keeps quoted Lua, newlines and data in one bounded protocol line", () => {
  const command = encodeRedisCliCommand(["EVAL", "return {ARGV[1], 7}\n", 0, "line1\n\"quoted\"\\end"]);
  assert.equal(command.split("\n").length, 2);
  assert.match(command, /\\n/u); assert.match(command, /\\"quoted\\"/u); assert.match(command, /\\\\end/u);
  for (const args of [[], ["SHUTDOWN"], ["GET", undefined], ["GET", "nul\0value"], ["SET", "key", "x".repeat(262_144)]]) {
    assert.throws(() => encodeRedisCliCommand(args), { code: "REDIS_CLI_ARGUMENT_REJECTED" });
  }
});

function protocolChild({ autoQuit = true } = {}) {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.commands = []; child.killed = false;
  let input = ""; let ended = false;
  child.endProcess = (code = 0, signal = null) => {
    if (ended) return; ended = true; child.emit("close", code, signal);
  };
  child.kill = () => { child.killed = true; setImmediate(() => child.endProcess(null, "SIGKILL")); return true; };
  child.stdin.on("data", (chunk) => {
    input += chunk.toString("utf8");
    let newline;
    while ((newline = input.indexOf("\n")) !== -1) { child.commands.push(input.slice(0, newline)); input = input.slice(newline + 1); }
  });
  if (autoQuit) child.stdin.on("finish", () => setImmediate(() => child.endProcess()));
  return child;
}

test("one persistent redis-cli child serializes commands and resolves each JSON reply", async () => {
  const child = protocolChild(); const client = createRedisCliSession(child);
  const first = client.ping(); const second = client.call("CLIENT", "ID");
  assert.deepEqual(child.commands, ['"PING"']);
  child.stdout.write('"PONG"\n'); assert.equal(await first, "PONG");
  assert.deepEqual(child.commands, ['"PING"', '"CLIENT" "ID"']);
  child.stdout.write("17\n"); assert.equal(await second, 17);
  await client.quit();
  assert.equal(client.diagnostics.sent, 2); assert.equal(client.diagnostics.received, 2);
  assert.equal(client.diagnostics.closed, true); assert.equal(client.diagnostics.exitCode, 0);
  assert.equal(child.killed, false); assert.equal(child.commands.at(-1), '"QUIT"');
});

test("UTF8 JSON responses split across pipe chunks are decoded without replacing characters", async () => {
  const child = protocolChild(); const client = createRedisCliSession(child);
  const result = client.get("synthetic");
  const bytes = Buffer.from('"合成"\n');
  child.stdout.write(bytes.subarray(0, 2)); child.stdout.write(bytes.subarray(2, 4)); child.stdout.write(bytes.subarray(4));
  assert.equal(await result, "合成"); await client.quit();
});

test("malformed or oversized responses and stderr fail closed without reflecting data", async () => {
  for (const [output, code] of [["invalid", "REDIS_CLI_INVALID_JSON"], ["oversized", "REDIS_CLI_OUTPUT_LIMIT"], ["stderr", "REDIS_CLI_STDERR"]]) {
    const child = protocolChild(); const client = createRedisCliSession(child);
    const result = client.get("synthetic");
    const rejected = assert.rejects(result, { code });
    if (output === "invalid") child.stdout.write('error:"SYNTHETIC_SECRET_BODY"\n');
    else if (output === "oversized") child.stdout.write(Buffer.alloc(1_048_577, "x"));
    else child.stderr.write("SYNTHETIC_SECRET_BODY");
    await rejected; await client.disconnect();
    assert.equal(client.diagnostics.closed, true); assert.equal(child.killed, true);
    assert.doesNotMatch(JSON.stringify(client.diagnostics), /SECRET_BODY/u);
  }
});

test("a timed-out Redis command kills and drains its real client process before cleanup continues", async () => {
  const child = protocolChild(); const client = createRedisCliSession(child, { commandTimeoutMs: 20 });
  await assert.rejects(client.ping(), { code: "REDIS_CLI_COMMAND_TIMEOUT" });
  await client.disconnect(); assert.equal(child.killed, true); assert.equal(client.diagnostics.closed, true);
});

test("quit waits for process exit instead of treating a written QUIT as successful drain", async () => {
  const child = protocolChild({ autoQuit: false }); const client = createRedisCliSession(child);
  let settled = false; const quitting = client.quit().then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); assert.equal(client.diagnostics.closed, false);
  child.endProcess(); await quitting; assert.equal(settled, true); assert.equal(client.diagnostics.closed, true);
});

test("cleanup ownership requires exact generated name, three labels and the pinned container image", () => {
  const container = { Name: `/${name}`, Config: { Image: redisImage, Labels: labels("container") } };
  assert.doesNotThrow(() => assertOwnedResource("container", container, expected));
  for (const changed of [
    { ...container, Name: "/production-redis" },
    { ...container, Config: { ...container.Config, Image: "redis:latest" } },
    { ...container, Config: { ...container.Config, Labels: { ...labels("container"), "dev.unfreq.recovery.run": "b123456789bc" } } },
    { ...container, Config: { ...container.Config, Labels: { ...labels("container"), "dev.unfreq.recovery.scope": "integration" } } },
    { ...container, Config: { ...container.Config, Labels: labels("volume") } },
  ]) assert.throws(() => assertOwnedResource("container", changed, expected));
  assert.throws(() => assertOwnedResource("container", container, { ...expected, name: name + "../foreign" }));
  assert.throws(() => assertOwnedResource("container", container, { ...expected, runId: "" }));
});

test("network and volume cleanup refuses a foreign or non-internal resource", () => {
  assert.doesNotThrow(() => assertOwnedResource("volume", { Name: name, Labels: labels("volume") }, expected));
  assert.doesNotThrow(() => assertOwnedResource("network", { Name: name, Labels: labels("network"), Internal: true }, expected));
  assert.throws(() => assertOwnedResource("volume", { Name: name, Labels: {} }, expected));
  assert.throws(() => assertOwnedResource("network", { Name: name, Labels: labels("network"), Internal: false }, expected));
  assert.throws(() => assertOwnedResource("network", { Name: "foreign", Labels: labels("network"), Internal: true }, expected));
});

test("actual production quota and one-time challenge Lua are reused without importing application configuration", async () => {
  const quotaSource = await readFile(path.join(root, "apps/api/src/shared/abuse-control.ts"), "utf8");
  const authSource = await readFile(path.join(root, "apps/api/src/modules/auth/service.ts"), "utf8");
  const clock = extractLua(quotaSource, "redisClock");
  const quota = extractLua(quotaSource, "quotaScript", { redisClock: clock });
  const verify = extractLua(authSource, "verifyChallengeScript");
  assert.match(clock, /redis\.call\('TIME'\)/u);
  assert.equal(quota.startsWith(clock), true);
  assert.match(quota, /redis\.call\('PEXPIREAT'/u);
  assert.match(verify, /'KEEPTTL'/u);
  assert.match(verify, /redis\.call\('DEL', KEYS\[1\]\)/u);
  assert.equal(quota.includes("${"), false);
  assert.equal(verify.includes("${"), false);
});

test("Lua literal extraction fails closed on syntax or interpolation changes", () => {
  const literal = "const fixture = `\nreturn 1\n`;";
  assert.equal(extractLua(literal.replaceAll("\n", "\r\n"), "fixture"), "\nreturn 1\n");
  assert.throws(() => extractLua(literal + literal, "fixture"), /declaration changed/);
  assert.throws(() => extractLua("const fixture = `${unknown}`;", "fixture"), /interpolation/);
  assert.throws(() => extractLua("const fixture = `return \\n`;", "fixture"), /escaping/);
  assert.throws(() => extractLua("const fixture = `return 1", "fixture"), /terminator/);
  assert.throws(() => extractLua(literal, "fixture; process.exit()"), /literal name/);
});

test("multipart AOF inventory rejects unexpected files, traversal, duplicate or incomplete output", () => {
  const hash = "a".repeat(64);
  const valid = `${hash} 81 ./appendonlydir/appendonly.aof.manifest\n${hash} 93 ./appendonlydir/appendonly.aof.1.incr.aof\n`;
  assert.equal(parseAofInventory(valid).length, 2);
  for (const output of ["", `${hash} 4 ./elsewhere/private\n`, valid + `${hash} 4 ./appendonlydir/../outside\n`,
    valid + `${hash} 4 ./appendonlydir/secret.txt\n`, valid + valid, `${hash} 2 ./appendonlydir/appendonly.aof.manifest\n`,
    `${hash} 9007199254740992 ./appendonlydir/appendonly.aof.1.incr.aof\n`]) {
    assert.throws(() => parseAofInventory(output));
  }
});

function cli(args, extra = {}) {
  return spawnSync(process.execPath, [runner, ...args], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, PATH: "", DOCKER_HOST: "tcp://127.0.0.1:9", DOCKER_CONTEXT: "missing-safety-context",
      DATABASE_URL: "SYNTHETIC_UNREAD_CONFIG", REDIS_URL: "SYNTHETIC_UNREAD_REDIS", ...extra } });
}

test("invalid arguments and remote Docker fail before Docker invocation or application configuration reads", () => {
  const invalid = cli(["--volume=production"]);
  assert.equal(invalid.error, undefined); assert.equal(invalid.status, 1); assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /accepts no URLs/);
  const remote = cli([]);
  assert.equal(remote.error, undefined); assert.equal(remote.status, 1); assert.equal(remote.stdout, "");
  assert.match(remote.stderr, /Remote Docker hosts are not allowed/);
  for (const result of [invalid, remote]) assert.doesNotMatch(result.stderr, /SYNTHETIC_UNREAD/u);
});

test("help does not need Docker, dependencies or configuration", () => {
  const result = cli(["--help"]);
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.match(result.stdout, /No resource or endpoint overrides/u);
});
