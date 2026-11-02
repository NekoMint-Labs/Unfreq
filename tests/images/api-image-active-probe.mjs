import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Run via docker exec in one disposable API container, before and after its
// restart. The host verifies raw attempt/error/lease SQL fields separately.
const mode = process.argv[2];
const runId = process.env.UNFREQ_IMAGE_VERIFICATION_RUN ?? "";
try {
  assert.equal(process.platform, "linux");
  assert.equal(process.cwd(), "/app");
  assert.ok(process.argv.length === 3 && ["prepare", "restarted"].includes(mode));
  assert.match(runId, /^[a-f0-9]{24}$/u);
  assert.equal(process.env.NODE_ENV, "production");
  assert.equal(process.env.SIGNAL_GENERATION_WORKER_ENABLED, "true");
  assert.equal(process.env.AI_SIGNAL_SCHEDULER_ENABLED, "false");
  assert.equal(process.env.ABUSE_PROTECTION_ENABLED, "true");
  assert.ok(process.env.AI_API_KEY === "IMAGE-SYNTHETIC-ONLY");
  assert.equal(process.env.AI_BASE_URL, "http://provider:4010/v1");
  assert.equal(process.env.API_PORT, "4000");
  for (const key of ["AI_FAST_API_KEY", "AI_FAST_BASE_URL", "EMBEDDING_API_KEY", "TTS_API_KEY", "RERANKER_API_KEY"]) {
    assert.ok((process.env[key] ?? "") === "");
  }
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.equal(databaseUrl.hostname, "postgres");
  assert.equal(databaseUrl.pathname, "/unfreq_image");
  assert.equal(new URL(process.env.REDIS_URL).hostname, "redis");
} catch {
  console.error(JSON.stringify({ mode, passed: false, phase: "configuration", error: "Synthetic configuration required" }));
  process.exit(1);
}
const statePath = "/tmp/api-active-state.json";
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
let phase = "configuration";
async function api(route, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`http://127.0.0.1:4000${route}`, { method,
    signal: AbortSignal.timeout(5000), redirect: "error",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.equal(typeof value.meta?.requestId, "string", "Missing response envelope");
  return { response, value };
}
async function providerState() {
  const response = await fetch("http://provider:4010/state", { signal: AbortSignal.timeout(2000), redirect: "error" });
  assert.equal(response.status, 200, "Provider state unavailable");
  const value = await response.json();
  assert.ok(Array.isArray(value.requests) && value.requests.length <= 8, "Invalid provider request inventory");
  assert.equal(value.received, value.requests.length);
  assert.equal(value.closed, value.requests.filter((entry) => entry.closed).length);
  assert.equal(value.active, value.received - value.closed);
  assert.ok(value.requests.every((entry, index) => entry.seq === index + 1 && ["first", "control"].includes(entry.tag) && typeof entry.closed === "boolean"));
  return value;
}
async function waitProvider(kind) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const value = await providerState();
    const first = value.requests.filter((entry) => entry.tag === "first");
    const controls = value.requests.filter((entry) => entry.tag === "control");
    assert.ok(first.length <= 1 && controls.length <= (kind === "prepare" ? 0 : 1), "Provider work was replayed");
    if (kind === "prepare" && first.length === 1) {
      assert.equal(first[0].closed, false, "First request ended before shutdown");
      assert.equal(value.active, 1);
      return value;
    }
    if (kind === "restarted" && first.length === 1 && controls.length === 1) {
      assert.equal(first[0].closed, true, "Original local request was not closed");
      assert.equal(controls[0].closed, false, "Control request ended before shutdown");
      assert.equal(value.received, 2);
      assert.equal(value.closed, 1);
      assert.equal(value.active, 1);
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Expected held synthetic provider request was not observed");
}
async function createSignal(cookie, marker) {
  const result = await api("/api/signals/", { method: "POST", cookie,
    body: { seedText: `合成 ${marker}：这是一条仅用于本机容器关停验收的测试种子。` } });
  assert.equal(result.response.status, 201, "Synthetic signal was not accepted");
  const signal = result.value.data?.signal;
  assert.ok(uuid(signal?.id));
  assert.equal(signal.visibility, "GENERATION_OWNER");
  assert.ok(["RECEIVED", "EXPANDING", "MATCHING", "WRITING"].includes(signal.generationStatus));
  return signal.id;
}
async function failedOriginal(state) {
  const result = await api(`/api/signals/${state.signalId}`, { cookie: state.cookie });
  assert.equal(result.response.status, 200, "Original signal cannot be read by its owner");
  const signal = result.value.data?.signal;
  assert.equal(signal?.id, state.signalId);
  assert.equal(signal.visibility, "GENERATION_OWNER");
  assert.equal(signal.generationStatus, "FAILED");
  assert.equal(signal.generationError, "这句种子暂时没有发出。可以重新发射。");
  // The ordinary HTTP mapper intentionally hides the internal
  // GENERATION_OUTCOME_UNKNOWN code. The host checks that exact code in SQL.
}
try {
  if (mode === "prepare") {
    phase = "clean provider";
    const initial = await providerState();
    assert.equal(initial.received, 0);
    assert.equal(initial.closed, 0);
    assert.equal(initial.active, 0);
    assert.deepEqual(initial.requests, []);
    phase = "registration";
    const registered = await api("/api/auth/register", { method: "POST",
      body: { password: `image-active-${randomBytes(24).toString("hex")}` } });
    assert.equal(registered.response.status, 201);
    const authorId = registered.value.data?.frequency?.id;
    assert.ok(uuid(authorId));
    const header = registered.response.headers.get("set-cookie");
    assert.ok(typeof header === "string" && /^unfreq_session=[^;\r\n]+;/u.test(header) &&
      ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"].every((attribute) => header.includes(attribute)), "Expected a secure synthetic session cookie");
    const cookie = header.split(";", 1)[0];
    phase = "first signal admission";
    const signalId = await createSignal(cookie, `IMAGE_SHUTDOWN_${runId}`);
    await writeFile(statePath, JSON.stringify({ runId, signalId, authorId, cookie }) + "\n", { flag: "wx", mode: 0o600 });
    phase = "first provider hold";
    const provider = await waitProvider("prepare");
    const current = await api(`/api/signals/${signalId}`, { cookie });
    assert.equal(current.response.status, 200);
    assert.equal(current.value.data?.signal?.generationStatus, "EXPANDING");
    console.log(JSON.stringify({ mode, passed: true, signalId, authorId, provider }));
  } else {
    phase = "stored synthetic session";
    const bytes = await readFile(statePath);
    assert.ok(bytes.length <= 4096);
    const state = JSON.parse(bytes);
    assert.equal(state.runId, runId);
    assert.ok(uuid(state.signalId) && uuid(state.authorId));
    assert.ok(typeof state.cookie === "string" && /^unfreq_session=[^;\r\n]+$/u.test(state.cookie), "Invalid synthetic session cookie");
    assert.equal(state.controlId, undefined, "Control signal was already created");
    phase = "original failed HTTP state";
    await failedOriginal(state);
    const beforeControl = await providerState();
    assert.equal(beforeControl.received, 1, "Original provider request was replayed");
    assert.deepEqual(beforeControl.requests, [{ seq: 1, tag: "first", closed: true }]);
    assert.equal(beforeControl.active, 0);
    phase = "control signal admission";
    const controlId = await createSignal(state.cookie, `IMAGE_CONTROL_${runId}`);
    assert.notEqual(controlId, state.signalId);
    await writeFile(statePath, JSON.stringify({ ...state, controlId }) + "\n", { mode: 0o600 });
    phase = "control provider hold";
    const provider = await waitProvider("restarted");
    phase = "original remains failed";
    await failedOriginal(state);
    console.log(JSON.stringify({ mode, passed: true, signalId: state.signalId, authorId: state.authorId, controlId, provider }));
  }
} catch {
  // Assertions never print a session token, password, response body or saved file.
  console.error(JSON.stringify({ mode, passed: false, phase, error: "Synthetic active-job probe failed" }));
  process.exitCode = 1;
}
