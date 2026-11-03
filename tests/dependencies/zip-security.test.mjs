import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { malformedZip64Fixture, validZip64Fixture } from "./zip-fixtures.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencyRoot = resolve(process.env.DEPENDENCY_TEST_ROOT ?? repositoryRoot);
// Always exercise both supported installed paths; a missing line must fail.
const dependencyLines = [
  ["root", "node_modules/fflate"],
  ["three-stdlib", "node_modules/three-stdlib/node_modules/fflate"],
];

function checkZip(location, body, expectedOutput = "ok\n") {
  const source = `
    const assert = require('node:assert/strict');
    const fflate = require(${JSON.stringify(resolve(dependencyRoot, location))});
    ${malformedZip64Fixture.toString()}
    ${validZip64Fixture.toString()}
    ${body}
    process.stdout.write('ok\\n');
  `;
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  // The parent deadline includes Windows startup. A timeout is a failure,
  // never evidence that a malicious archive was safely rejected.
  const child = spawnSync(process.execPath, [
    "--max-old-space-size=64", "--stack_size=512", "--input-type=commonjs", "-e", source,
  ], {
    cwd: dependencyRoot, env, encoding: "utf8", timeout: 5000,
    killSignal: "SIGKILL", maxBuffer: 8192, windowsHide: true,
  });
  const detail = `${location}: status=${child.status}, signal=${child.signal}\n${child.error?.message ?? ""}\nstdout=${child.stdout ?? ""}\nstderr=${child.stderr ?? ""}`.slice(0, 8192);
  assert.equal(child.error, undefined, detail);
  assert.equal(child.signal, null, detail);
  assert.equal(child.status, 0, detail);
  assert.equal(child.stderr, "", detail);
  assert.equal(child.stdout, expectedOutput, detail);
}

// GHSA-px8p-9vwx-vf98: a ZIP64 compressed-size sentinel without tag 0x0001
// must terminate with an invalid-ZIP error instead of scanning past the input.
for (const [line, location] of dependencyLines) {
  test(`fflate ${line} preserves stored and deflated Unicode/binary ZIP roundtrips`, () => {
    checkZip(location, `
      const input = {
        'plain.txt': new TextEncoder().encode('ordinary control'),
        'dir/data.bin': new Uint8Array([0, 1, 127, 128, 255]),
        'unicode-资料.txt': new TextEncoder().encode('普通文本'),
      };
      for (const level of [0, 6]) {
        const result = fflate.unzipSync(fflate.zipSync(input, { level }));
        assert.deepEqual(Object.keys(result).sort(), Object.keys(input).sort());
        for (const name of Object.keys(input)) assert.deepEqual(result[name], input[name]);
      }
    `);
  });

  test(`fflate ${line} accepts valid ZIP64 after an unknown extra field`, () => {
    checkZip(location, `
      const result = fflate.unzipSync(validZip64Fixture());
      assert.deepEqual(Object.keys(result), ['a']);
      assert.deepEqual(result.a, new Uint8Array([111, 107]));
    `);
  });

  test(`fflate ${line} rejects missing ZIP64 extra fields within its execution bound`, () => {
    checkZip(location, `
      const data = malformedZip64Fixture();
      assert.equal(data.length, 145);
      process.stdout.write('before-unzip\\n');
      let rejected = false;
      try { fflate.unzipSync(data); }
      catch (error) {
        // 0.6 throws a string; 0.8 throws Error with code 13.
        const message = typeof error === 'string' ? error : error?.message;
        assert.equal(typeof message, 'string');
        assert.match(message, /invalid zip/i);
        rejected = true;
      }
      assert.equal(rejected, true, 'Malformed ZIP64 data was accepted.');
    `, "before-unzip\nok\n");
  });
}
