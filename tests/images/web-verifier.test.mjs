import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(root, "scripts", "verify-web-image.mjs");
function invoke(args, extra = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root, env: { ...process.env, ...extra }, encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
}
test("image help does not require Docker or inspect an endpoint", () => {
  const result = invoke(["--help"], { DOCKER_HOST: "tcp://forbidden.invalid:2375", PATH: "" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /synthetic data only/);
  assert.equal(result.stderr, "");
});
test("image verifier refuses image, URL, project and arbitrary argument overrides before Docker", () => {
  for (const args of [["--image", "existing-production"], ["http://example.invalid"], ["--project", "existing"],
    ["--resume-runtime=../other"], ["--resume-runtime=abc"], ["--resume-runtime=1234567890abcdef12345678", "extra"], ["--help", "extra"]]) {
    const result = invoke(args, { PATH: "" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /spawn|ENOENT|docker/i);
  }
});
test("remote Docker refusal never executes Docker during cleanup", () => {
  for (const DOCKER_HOST of ["tcp://forbidden.invalid:2375", "npipe:////remote-server/pipe/docker_engine"]) {
    for (const args of [[], ["--resume-runtime=1234567890abcdef12345678"]]) {
      const result = invoke(args, { DOCKER_HOST, PATH: "" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Remote Docker endpoints are refused/);
      assert.doesNotMatch(result.stderr, /spawn|ENOENT/);
    }
  }
});

function invokeApi(args, extra = {}) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "verify-api-image.mjs"), ...args], {
    cwd: root, env: { ...process.env, ...extra }, encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
}
test("API image help works without Docker or inherited credentials", () => {
  const result = invokeApi(["--help"], { DOCKER_HOST: "tcp://forbidden.invalid:2375", PATH: "" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /disposable PostgreSQL\/Redis/);
  assert.equal(result.stderr, "");
});
test("API image verifier rejects caller-selected resources before Docker", () => {
  for (const args of [["--image", "existing-production"], ["--database-url=postgres://localhost/production"], ["--resume-runtime=../other"], ["--resume-runtime=abc"], ["--resume-shutdown=../other"], ["--help", "extra"]]) {
    const result = invokeApi(args, { PATH: "" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /spawn|ENOENT/i);
  }
});
test("API image verifier refuses remote and UNC endpoints without cleanup calls", () => {
  for (const DOCKER_HOST of ["tcp://forbidden.invalid:2375", "npipe:////remote-server/pipe/docker_engine"]) {
    for (const args of [[], ["--resume-runtime=1234567890abcdef12345678"], ["--resume-shutdown=1234567890abcdef12345678"]]) {
      const result = invokeApi(args, { DOCKER_HOST, PATH: "" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Remote Docker endpoints are refused/);
      assert.doesNotMatch(result.stderr, /spawn|ENOENT/);
    }
  }
});

const readyHelper = pathToFileURL(path.join(root, "scripts", "image-http-ready.mjs")).href;
function readinessChild(body) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval",
    `import { runWithReferencedTimeout } from ${JSON.stringify(readyHelper)};\n${body}`], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, PATH: "", DOCKER_HOST: "tcp://forbidden.invalid:2375" },
  });
}
test("readiness deadline keeps a handle-less pending request alive until it aborts", () => {
  const result = readinessChild(`
    let aborted = false;
    try {
      await runWithReferencedTimeout(signal => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
      }), 30);
      throw Error('Expected timeout');
    } catch (error) {
      if (!aborted || error.message !== 'Owned image HTTP request timed out.') throw error;
      process.stdout.write('bounded-request');
    }
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "bounded-request");
  assert.equal(result.stderr, "");
});
test("readiness deadline also bounds a response predicate that never settles", () => {
  const result = readinessChild(`
    try {
      await runWithReferencedTimeout(async () => { await new Promise(() => {}); }, 30);
      throw Error('Expected timeout');
    } catch (error) {
      if (error.message !== 'Owned image HTTP request timed out.') throw error;
      process.stdout.write('bounded-body');
    }
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "bounded-body");
  assert.equal(result.stderr, "");
});
test("successful readiness clears its long deadline so the process can exit naturally", () => {
  const result = readinessChild(`
    if (await runWithReferencedTimeout(async () => 'ready', 60_000) !== 'ready') throw Error('Wrong value');
    process.stdout.write('ready');
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ready");
  assert.equal(result.stderr, "");
});
