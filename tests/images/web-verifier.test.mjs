import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  for (const args of [["--image", "existing-production"], ["http://example.invalid"], ["--project", "existing"], ["--help", "extra"]]) {
    const result = invoke(args, { PATH: "" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /spawn|ENOENT|docker/i);
  }
});
test("remote Docker refusal never executes Docker during cleanup", () => {
  const result = invoke([], { DOCKER_HOST: "tcp://forbidden.invalid:2375", PATH: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Remote Docker endpoints are refused/);
  assert.doesNotMatch(result.stderr, /spawn|ENOENT/);
});
