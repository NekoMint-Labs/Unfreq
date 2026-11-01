import assert from "node:assert/strict";

export function assertOwnedWebStop(state, { role, stopRequested, signal } = {}) {
  assert.ok(role === "direct" || role === "runtime", "Unknown owned Web process role");
  assert.equal(typeof stopRequested, "boolean", "The stop request must be recorded explicitly");
  assert.equal(state.Running, false, "Owned Web process is still running");
  assert.equal(state.OOMKilled, false, "Owned Web process was killed for exceeding memory");
  assert.equal(state.Dead, false, "Owned Web process is dead");
  assert.equal(state.Error, "", "Docker reported an owned Web process error");

  if (state.ExitCode === 0) return "exit-zero";
  // Next's direct npm start command reports 128 + SIGTERM after its close
  // handler. This records the expected signal exit, not request draining.
  if (role === "direct" && stopRequested && signal === "SIGTERM" && state.ExitCode === 143) {
    return "sigterm";
  }
  assert.fail("Owned Web process exited outside the permitted stop policy");
}
