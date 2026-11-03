import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

// Host orchestration, loaded from the verifier's frozen source snapshot.
// All container IDs and credentials come from its owned internal test network.
export async function verifyActiveShutdown({ docker, createContainer, untilReady, inspectOwned,
  imageId, apiEnv, policy, pg, directory, runId, record, save }) {
  const source = (name) => path.join(directory, "verification", "tests", "images", name);
  const copy = (id, name, destination) => docker(["cp", source(name), `${id}:${destination}`]);
  const apiReady = (id) => untilReady(id, ["node", "--input-type=module", "-e",
    "const r=await fetch('http://127.0.0.1:4000/health',{signal:AbortSignal.timeout(1500)});if(r.status!==200)process.exit(1);"]);
  const snapshot = async (id) => JSON.parse((await docker(["exec", id, "node", "--input-type=module", "-e",
    "const r=await fetch('http://127.0.0.1:4010/state',{signal:AbortSignal.timeout(1500)});if(r.status!==200)throw Error('Provider state unavailable');console.log(JSON.stringify(await r.json()));"])).stdout);
  const readRow = async (id) => {
    assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
    await inspectOwned("container", pg);
    const query = `select json_build_object('id',id,'status',status,'generationStatus',generation_status,
      'error',generation_error,'attemptCount',generation_attempt_count,'owner',generation_lease_owner,
      'lease',generation_lease_until,'dispatched',generation_dispatch_started_at is not null)
      from signals where id='${id}'::uuid`;
    return JSON.parse((await docker(["exec", pg, "psql", "-X", "-U", "postgres", "-d", "unfreq_image", "-At", "-c", query])).stdout.trim());
  };
  const failedUnknown = (row) => {
    assert.equal(row.status, "DRAFT");
    assert.equal(row.generationStatus, "FAILED");
    assert.equal(row.error, "GENERATION_OUTCOME_UNKNOWN");
    assert.equal(row.attemptCount, 1);
    assert.equal(row.owner, null);
    assert.equal(row.lease, null);
    assert.equal(row.dispatched, true);
  };
  const stop = async (id, phase, probeStartedAt) => {
    const before = await inspectOwned("container", id);
    assert.equal(before.State.Running, true);
    assert.deepEqual(JSON.parse((await docker(["exec", id, "node", "--input-type=module", "-e",
      "import{readFileSync}from'node:fs';console.log(JSON.stringify(readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean))); "])).stdout), ["node", "dist/server.js"]);
    const providerBeforeStop = await snapshot(provider);
    assert.equal(providerBeforeStop.active, 1, "A real local Provider request must still be held when SIGTERM is requested");
    assert.ok(Number.isFinite(providerBeforeStop.oldestActiveMs));
    const started = performance.now();
    await docker(["stop", "--time", "35", id], { timeoutMs: 45_000 });
    const after = await inspectOwned("container", id);
    const logs = await docker(["logs", id]);
    await writeFile(path.join(directory, `active-${phase}.log`), logs.stdout + logs.stderr);
    const value = { phase, elapsedMs: performance.now() - started, exitCode: after.State.ExitCode,
      signal: after.Config.StopSignal || "SIGTERM", oomKilled: after.State.OOMKilled, dead: after.State.Dead,
      error: after.State.Error, running: after.State.Running, hostPid: before.State.Pid, startedAt: before.State.StartedAt,
      providerBeforeStop, probeToStoppedMs: performance.now() - probeStartedAt };
    record.stops.push(value);
    await save();
    assert.equal(value.exitCode, 0);
    assert.equal(value.oomKilled, false);
    assert.equal(value.dead, false);
    assert.equal(value.running, false);
    assert.equal(value.error, "");
    assert.ok(providerBeforeStop.oldestActiveMs + value.elapsedMs < record.materialTaskBudgetMs,
      "The held request must close before its natural Provider task deadline");
    assert.ok(value.probeToStoppedMs < record.materialTaskBudgetMs,
      "The complete probe-to-stop upper bound, including connection setup, must precede the natural task deadline");
    assert.match(logs.stdout + logs.stderr, /api server shutting down/u);
    return value;
  };

  Object.assign(record, { syntheticOnly: true, shutdownGraceMs: 1000, stops: [], checks: [],
    scope: "Real production image generation worker and local held HTTP only; no remote paid work or production data." });
  const provider = await createContainer("provider", imageId, ["--memory", "128m", "--cap-drop", "ALL",
    "--env", `UNFREQ_IMAGE_VERIFICATION_RUN=${runId}`], ["node", "/tmp/held-provider.mjs"], false);
  await copy(provider, "api-image-held-provider.mjs", "/tmp/held-provider.mjs");
  await docker(["start", provider]);
  await untilReady(provider, ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:4010/state',{signal:AbortSignal.timeout(1500)});if(r.status!==200)process.exit(1);"]);

  const activePolicy = structuredClone(policy);
  activePolicy.budgets.chatCallsSite.limit = 4; // Only the internal fixture can receive these synthetic calls.
  const activeEnv = { ...apiEnv, SIGNAL_GENERATION_WORKER_ENABLED: "true", SIGNAL_GENERATION_CONCURRENCY: "1",
    SIGNAL_GENERATION_SCAN_INTERVAL_MS: "100", SIGNAL_GENERATION_SHUTDOWN_GRACE_MS: "1000",
    ABUSE_LIMITS_JSON: JSON.stringify(activePolicy), AI_BASE_URL: "http://provider:4010/v1",
    AI_API_KEY: "IMAGE-SYNTHETIC-ONLY", AI_MODEL: "image-shutdown-fixture", AI_PROVIDER: "openai-compatible" };
  const api = await createContainer("api-active", imageId, ["--memory", "512m", "--cap-drop", "ALL",
    ...Object.entries(activeEnv).flatMap(([key, value]) => ["--env", `${key}=${value}`])]);
  await apiReady(api);
  record.materialTaskBudgetMs = JSON.parse((await docker(["exec", api, "node", "--input-type=module", "-e",
    "import{getAiProviderTimeoutMs}from'/app/apps/api/dist/modules/ai/provider-routing.js';console.log(JSON.stringify(getAiProviderTimeoutMs('signal-material')));"])).stdout);
  assert.ok(Number.isFinite(record.materialTaskBudgetMs) && record.materialTaskBudgetMs > 1000);
  await copy(api, "api-image-active-probe.mjs", "/tmp/active-probe.mjs");
  const firstProbeStartedAt = performance.now();
  const prepared = JSON.parse((await docker(["exec", api, "node", "/tmp/active-probe.mjs", "prepare"], { timeoutMs: 45_000 })).stdout);
  record.prepared = prepared;
  assert.equal(prepared.provider.received, 1);
  assert.equal(prepared.provider.active, 1);
  record.checks.push("Real HTTP accepted a managed generation and its local Provider request is held");
  const firstStop = await stop(api, "first", firstProbeStartedAt);
  record.firstRow = await readRow(prepared.signalId);
  failedUnknown(record.firstRow);
  record.firstProvider = await snapshot(provider);
  assert.equal(record.firstProvider.received, 1);
  assert.equal(record.firstProvider.closed, 1);
  assert.equal(record.firstProvider.active, 0);
  record.checks.push("SIGTERM drains the held request and persists an unknown outcome without a live lease");

  await docker(["start", api]);
  await apiReady(api);
  const restartState = await inspectOwned("container", api);
  assert.notEqual(restartState.State.StartedAt, firstStop.startedAt);
  assert.notEqual(restartState.State.Pid, firstStop.hostPid);
  record.restart = { priorHostPid: firstStop.hostPid, hostPid: restartState.State.Pid, startedAt: restartState.State.StartedAt };
  const controlProbeStartedAt = performance.now();
  const restarted = JSON.parse((await docker(["exec", api, "node", "/tmp/active-probe.mjs", "restarted"], { timeoutMs: 45_000 })).stdout);
  record.restarted = restarted;
  assert.equal(restarted.signalId, prepared.signalId);
  assert.equal(restarted.provider.received, 2);
  assert.equal(restarted.provider.active, 1);
  assert.deepEqual(await readRow(prepared.signalId), record.firstRow);
  record.checks.push("Restart reuses the account, keeps the original failure and accepts new work without replay");
  await stop(api, "control", controlProbeStartedAt);
  record.controlRow = await readRow(restarted.controlId);
  failedUnknown(record.controlRow);
  assert.deepEqual(await readRow(prepared.signalId), record.firstRow);
  record.finalProvider = await snapshot(provider);
  assert.equal(record.finalProvider.received, 2);
  assert.equal(record.finalProvider.closed, 2);
  assert.equal(record.finalProvider.active, 0);
  record.checks.push("A second held task also drains cleanly and neither task writes a late completion");
  record.passed = record.checks.length;
  await writeFile(path.join(directory, "active-shutdown.json"), JSON.stringify(record, null, 2) + "\n");
  await save();
}
