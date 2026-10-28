import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("../../scripts/run-api-integration.mjs", import.meta.url));
const root = path.resolve(path.dirname(runner), "..");

function rejectedBeforeDocker(args, dockerHost, message) {
  const result = spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    env: {
      ...process.env,
      DOCKER_HOST: dockerHost,
      // A missing context is an extra fence: a regression must still never
      // reach an existing engine or a remote endpoint during this test.
      DOCKER_CONTEXT: "unfreq-safety-context-that-does-not-exist",
    },
    encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, message);
}

test("integration runner refuses caller-supplied connection arguments before doing work", () => {
  rejectedBeforeDocker(["--database-url=postgres://127.0.0.1:9/other"], "tcp://127.0.0.1:9", /accepts no external URLs/);
});

test("integration runner refuses TCP Docker endpoints before doing work", () => {
  rejectedBeforeDocker([], "tcp://127.0.0.1:9", /Remote Docker hosts are not allowed/);
});

test("integration runner refuses UNC-style npipe instead of mistaking the scheme for locality", () => {
  rejectedBeforeDocker([], "npipe:////127.0.0.1/pipe/docker_engine", /Remote Docker hosts are not allowed/);
});
