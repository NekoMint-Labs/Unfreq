import assert from "node:assert/strict";
import test from "node:test";
import { assertOwnedWebStop } from "../../scripts/web-image-stop.mjs";

const stopped = { Running: false, OOMKilled: false, Dead: false, Error: "", ExitCode: 0 };

test("owned Web stop results follow the role and requested-signal contract", () => {
  const cases = [
    { role: "direct", stopRequested: false, signal: undefined, exitCode: 0, expected: "exit-zero" },
    { role: "direct", stopRequested: true, signal: "SIGTERM", exitCode: 0, expected: "exit-zero" },
    { role: "direct", stopRequested: true, signal: "SIGTERM", exitCode: 143, expected: "sigterm" },
    { role: "runtime", stopRequested: false, signal: undefined, exitCode: 0, expected: "exit-zero" },
    { role: "runtime", stopRequested: true, signal: "SIGTERM", exitCode: 0, expected: "exit-zero" },
    { role: "runtime", stopRequested: true, signal: "SIGTERM", exitCode: 143 },
    { role: "direct", stopRequested: false, signal: "SIGTERM", exitCode: 143 },
    { role: "direct", stopRequested: true, signal: undefined, exitCode: 143 },
    { role: "direct", stopRequested: true, signal: "SIGINT", exitCode: 143 },
    { role: "direct", stopRequested: true, signal: "SIGKILL", exitCode: 143 },
    ...["direct", "runtime"].flatMap((role) => [1, 130, 137, -1, null, "0", "143"].map((exitCode) => ({
      role, stopRequested: true, signal: "SIGTERM", exitCode,
    }))),
  ];
  for (const { exitCode, expected, ...options } of cases) {
    const state = { ...stopped, ExitCode: exitCode };
    if (expected) assert.equal(assertOwnedWebStop(state, options), expected);
    else assert.throws(() => assertOwnedWebStop(state, options), assert.AssertionError);
  }
});

test("running, OOM, dead and Docker error states fail even with an otherwise permitted exit", () => {
  const badStates = [
    { Running: true }, { Running: undefined }, { Running: 0 },
    { OOMKilled: true }, { OOMKilled: undefined }, { OOMKilled: 0 },
    { Dead: true }, { Dead: undefined }, { Dead: 0 },
    { Error: "synthetic Docker error" }, { Error: undefined }, { Error: null },
  ];
  for (const patch of badStates) {
    for (const exitCode of [0, 143]) {
      assert.throws(() => assertOwnedWebStop({ ...stopped, ...patch, ExitCode: exitCode }, {
        role: "direct", stopRequested: true, signal: "SIGTERM",
      }), assert.AssertionError);
    }
  }
});

test("unknown roles and missing or non-boolean stop records are refused", () => {
  for (const role of [undefined, "worker", "", null]) {
    assert.throws(() => assertOwnedWebStop(stopped, { role, stopRequested: true, signal: "SIGTERM" }), assert.AssertionError);
  }
  for (const stopRequested of [undefined, null, 0, 1, "true"]) {
    assert.throws(() => assertOwnedWebStop(stopped, { role: "direct", stopRequested, signal: "SIGTERM" }), assert.AssertionError);
  }
  assert.throws(() => assertOwnedWebStop(stopped), assert.AssertionError);
});

test("the stop policy leaves the inspected state and stop request unchanged", () => {
  const state = Object.freeze({ ...stopped, ExitCode: 143 });
  const options = Object.freeze({ role: "direct", stopRequested: true, signal: "SIGTERM" });
  assert.equal(assertOwnedWebStop(state, options), "sigterm");
  assert.deepEqual(state, { ...stopped, ExitCode: 143 });
  assert.deepEqual(options, { role: "direct", stopRequested: true, signal: "SIGTERM" });
});
