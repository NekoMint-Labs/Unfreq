import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "linux", "API image acceptance requires a disposable Linux Docker runner.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.resolve(root, process.env.API_IMAGE_SOURCE_ROOT ?? ".");
assert.ok(source === root || source === path.join(root, "baseline"));
const imageFile = path.resolve(root, process.env.API_IMAGE_ID_FILE ?? "test-results/high-dependency-api-image.id");
const reportFile = path.resolve(root, process.env.API_IMAGE_REPORT ?? "test-results/high-dependency-api-image.json");
assert.equal(path.dirname(reportFile), path.join(root, "test-results"));
const imageId = (await readFile(imageFile, "utf8")).trim();
assert.match(imageId, /^sha256:[a-f0-9]{64}$/u);
const exec = promisify(execFile);
const docker = (...args) => exec("docker", args, { cwd: root, timeout: 35_000, maxBuffer: 2_097_152 });
const inspect = async (id) => JSON.parse((await docker("inspect", id)).stdout)[0];
const contextName = (await docker("context", "show")).stdout.trim();
const context = JSON.parse((await docker("context", "inspect", contextName)).stdout)[0];
assert.match(context.Endpoints?.docker?.Host ?? "", /^unix:\/\/\//u, "Use only the disposable local Docker daemon.");
if (process.env.DOCKER_HOST) assert.match(process.env.DOCKER_HOST, /^unix:\/\/\//u);
const image = JSON.parse((await docker("image", "inspect", imageId)).stdout)[0];
assert.equal(image.Id, imageId);
assert.equal(image.Config.Labels?.["org.opencontainers.image.revision"], process.env.EXPECTED_API_REVISION);
const journal = JSON.parse(await readFile(path.join(source, "apps/api/src/db/migrations/meta/_journal.json"), "utf8"));
const fixedMain = "e5b459cf0e067fa391befb095bf3e87b9370cc41";
const isBaseline = source === path.join(root, "baseline");
if (isBaseline) {
  assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim(), fixedMain);
  assert.equal(image.Config.Labels["org.opencontainers.image.revision"], fixedMain);
}
assert.deepEqual({ ...journal, entries: [] }, { version: "7", dialect: "postgresql", entries: [] });
assert.equal(journal.entries.length, isBaseline ? 24 : 25,
  "Only the fixed 24-migration main baseline or the exact 25-migration C1 candidate is supported.");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// These pins are from main e5b459c and C1 388bc5c, not the mutable candidate.
assert.equal(hash(JSON.stringify(journal.entries.slice(0, 24))), "cde2e7f2a9c908009d98c12b5df4e030896ce8e142ab124044b3f2a90e33bd28");
if (!isBaseline) {
  assert.deepEqual(journal.entries[24], { idx: 24, version: "7", when: 1793221491240,
    tag: "0024_c1_publication_foundation", breakpoints: true });
}
const migrations = await Promise.all(journal.entries.map(async ({ tag, when }) => {
  assert.match(tag, /^[a-zA-Z0-9_-]+$/u);
  const sql = await readFile(path.join(source, "apps/api/src/db/migrations", tag + ".sql"));
  // Normalize only checkout CRLF for provenance; compare actual ledger hashes
  // against the original bytes that the platform's migrator actually reads.
  return { tag, when, hash: hash(sql), sourceHash: hash(sql.toString("utf8").replaceAll("\r\n", "\n")) };
}));
const sourceManifest = migrations.map(({ tag, when, sourceHash }) => ({ tag, when, hash: sourceHash }));
assert.equal(hash(JSON.stringify(sourceManifest.slice(0, 24))), "556cec334a4260908800a878a46b1d6470690b329bf4970849e6c59fb785c43e");
if (!isBaseline) assert.equal(migrations[24].sourceHash, "9405d5d05704875af7e9cdd5df5db9234a8f5c3422ab2661c4da48a0b0e3d021");
const expectedLedger = migrations.map(({ hash, when }) => ({ hash, createdAt: when }));
const runId = randomUUID().replaceAll("-", "");
const label = "unfreq.high-dependency.run";
const prefix = "unfreq-high-" + runId;
const network = prefix + "-network";
const resources = [];
let networkCreated = false;
const password = "SyntheticPassword-" + randomUUID();
const databasePassword = randomUUID();
const sessionSecret = randomUUID() + randomUUID();
const providerSecret = randomUUID() + randomUUID();
const secrets = [password, databasePassword, sessionSecret, providerSecret];
const report = { runId, imageId, sourceRevision: image.Config.Labels["org.opencontainers.image.revision"],
  checkout: (await exec("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim(),
  migrations: { count: expectedLedger.length, sourceManifestSha256: hash(JSON.stringify(sourceManifest)), isBaseline },
  startedAt: new Date().toISOString(), checks: [], passed: false, cleaned: false };
const check = (name) => { report.checks.push(name); console.log("Passed: " + name); };
await mkdir(path.dirname(reportFile), { recursive: true });
const save = () => writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
const redact = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "[synthetic-redacted]"), value);
async function create(role, serviceImage, options = [], command = []) {
  const name = prefix + "-" + role;
  const id = (await docker("run", "--detach", "--name", name, "--label", label + "=" + runId,
    "--network", network, "--network-alias", role, ...options, serviceImage, ...command)).stdout.trim();
  assert.match(id, /^[a-f0-9]{64}$/u);
  const current = await inspect(id);
  assert.equal(current.Name, "/" + name);
  assert.equal(current.Config.Labels[label], runId);
  resources.push({ id, name, imageId: current.Image });
  return id;
}
async function waitFor(checker, budget = 60_000) {
  const deadline = Date.now() + budget;
  while (true) {
    try { if (await checker()) return; } catch { /* Services are still starting. */ }
    assert.ok(Date.now() < deadline, "An isolated service did not become ready within its setup budget.");
    await delay(250);
  }
}
async function request(container, target, options = {}) {
  assert.ok(target.startsWith("/") && !target.startsWith("//"));
  const input = { target, ...options };
  const code = `const input=${JSON.stringify(input)}; const r=await fetch('http://127.0.0.1:4000'+input.target,{method:input.method??'GET',headers:input.headers,body:input.body===undefined?undefined:JSON.stringify(input.body),signal:AbortSignal.timeout(5000)}); console.log(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()}));`;
  return JSON.parse((await docker("exec", container, "node", "--input-type=module", "-e", code)).stdout);
}
let failure;
try {
  await docker("network", "create", "--internal", "--label", label + "=" + runId, network);
  networkCreated = true;
  const pg = await create("postgres", "pgvector/pgvector:pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a",
    ["--env", "POSTGRES_DB=unfreq_security", "--env", "POSTGRES_USER=unfreq_test", "--env", "POSTGRES_PASSWORD=" + databasePassword,
      "--tmpfs", "/var/lib/postgresql/data"]);
  const redis = await create("redis", "redis:7-alpine@sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af",
    ["--tmpfs", "/data"], ["redis-server", "--save", "", "--appendonly", "no"]);
  await waitFor(async () => (await docker("exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "unfreq_test", "-d", "unfreq_security")).stdout.includes("accepting connections"));
  await waitFor(async () => (await docker("exec", redis, "redis-cli", "ping")).stdout.trim() === "PONG");
  const rules = ["registerIp", "registerSite", "passwordRequestIp", "passwordRequestSite", "passwordFailureIp", "passwordFailureIdentityIp",
    "emailRequestIp", "emailRequestSite", "emailVerifyIp", "emailVerifySite", "generationRequestUser", "generationDailyUser", "generationDailySite",
    "audioReadIp", "audioRequestIp", "audioNewIp", "audioNewDailySite", "diagnosticIp", "diagnosticSite", "chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"];
  // The immutable baseline predates the new mandatory report budgets.
  if (!isBaseline) rules.push("reportRequestUser", "reportRequestIp", "reportReadUser");
  const paid = new Set(["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"]);
  const policy = { namespace: prefix, pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000,
    budgets: Object.fromEntries(rules.map((rule) => [rule, { limit: paid.has(rule) ? 0 : 20, windowMs: 60_000 }])) };
  const environment = {
    NODE_ENV: "production", API_HOST: "0.0.0.0", API_PORT: "4000", WEB_ORIGIN: "https://security-image.test",
    DATABASE_URL: `postgres://unfreq_test:${databasePassword}@postgres:5432/unfreq_security`, REDIS_URL: "redis://redis:6379",
    SESSION_SECRET: sessionSecret, PROVIDER_CONFIG_SECRET: providerSecret, AUTH_LOGIN_DELIVERY_MODE: "disabled", AUTH_LOGIN_CODE_RESPONSE: "disabled",
    ABUSE_LIMITS_JSON: JSON.stringify(policy), LOG_LEVEL: "info", SIGNAL_GENERATION_WORKER_ENABLED: "false",
    AI_API_KEY: "", AI_FAST_API_KEY: "", EMBEDDING_API_KEY: "", RERANKER_API_KEY: "", TTS_API_KEY: "",
  };
  const api = await create("api", imageId, Object.entries(environment).flatMap(([key, value]) => ["--env", key + "=" + value]));
  await waitFor(async () => (await request(api, "/health/deep")).status === 200);
  const health = JSON.parse((await request(api, "/health/deep")).body);
  assert.deepEqual(health.data.dependencies, { postgres: "ok", redis: "ok" });
  check("the unchanged default API entrypoint runs against isolated PostgreSQL and Redis");
  const ledger = JSON.parse((await docker("exec", pg, "psql", "-U", "unfreq_test", "-d", "unfreq_security", "-At", "-c",
    "select coalesce(json_agg(json_build_object('hash',hash,'createdAt',created_at) order by created_at),'[]') from drizzle.__drizzle_migrations")).stdout.trim());
  assert.deepEqual(ledger, expectedLedger);
  check(`all ${expectedLedger.length} pinned SQL migrations and journal timestamps match the actual ledger`);
  const anonymous = await request(api, "/api/me");
  assert.equal(anonymous.status, 401);
  assert.equal(JSON.parse(anonymous.body).error.code, "UNAUTHORIZED");
  const invalid = await request(api, "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: { password: "short" } });
  assert.equal(invalid.status, 400);
  assert.equal(JSON.parse(invalid.body).error.code, "VALIDATION_ERROR");
  check("anonymous authorization and invalid registration retain their error contracts");
  const registered = await request(api, "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: { password } });
  assert.equal(registered.status, 201);
  const body = JSON.parse(registered.body);
  assert.match(body.data.frequency.freqCode, /^FM \d{2}\.\d{2}$/u);
  assert.equal(typeof body.data.sessionToken, "string");
  secrets.push(body.data.sessionToken);
  assert.match(registered.headers["set-cookie"], /HttpOnly/u);
  assert.match(registered.headers["set-cookie"], /Secure/u);
  const authenticated = await request(api, "/api/me", { headers: { authorization: "Bearer " + body.data.sessionToken } });
  assert.equal(authenticated.status, 200);
  assert.equal(JSON.parse(authenticated.body).data.frequency.freqCode, body.data.frequency.freqCode);
  check("registration, a secure HttpOnly session and authenticated identity work in the actual image");
  const pid1 = (await docker("exec", api, "node", "-e", "process.stdout.write(require('node:fs').readFileSync('/proc/1/cmdline','utf8').replaceAll('\\0',' '))")).stdout;
  report.pid1 = pid1;
  const logOutput = await docker("logs", api);
  const logs = logOutput.stdout + logOutput.stderr;
  assert.ok(!secrets.some((secret) => logs.includes(secret)), "Synthetic secrets leaked into application logs.");
  check("request logging continues to omit secret request and session values");
  const beforeStop = performance.now();
  await docker("stop", "--time", "10", api);
  const stopped = await inspect(api);
  report.shutdown = { elapsedMs: performance.now() - beforeStop, exitCode: stopped.State.ExitCode,
    oomKilled: stopped.State.OOMKilled, graceful: stopped.State.ExitCode === 0 };
  assert.equal(stopped.State.Running, false);
  assert.equal(stopped.State.OOMKilled, false);
  assert.ok(report.shutdown.elapsedMs < 15_000, "Idle Docker stop exceeded the existing 10-second stop plus observation allowance.");
  assert.ok([0, 137, 143].includes(stopped.State.ExitCode), "Unexpected API shutdown failure.");
  if (process.env.API_IMAGE_BASELINE_REPORT) {
    const baseline = JSON.parse(await readFile(path.resolve(root, process.env.API_IMAGE_BASELINE_REPORT), "utf8"));
    assert.equal(baseline.passed, true);
    assert.equal(baseline.cleaned, true);
    assert.deepEqual(ledger, expectedLedger);
    assert.equal(report.shutdown.exitCode, baseline.shutdown.exitCode, "Candidate shutdown changed from the fixed main baseline.");
    report.baselineComparison = { sourceRevision: baseline.sourceRevision, imageId: baseline.imageId,
      exitCode: baseline.shutdown.exitCode, sameShutdownExitCode: true };
  }
  check("idle shutdown is bounded and its actual legacy npm entrypoint result is recorded");
  report.passed = true;
} catch (error) {
  failure = error;
  report.failure = redact(error.stack ?? String(error));
} finally {
  const cleanupErrors = [];
  for (const owned of resources.reverse()) {
    try {
      const current = await inspect(owned.id);
      assert.equal(current.Config.Labels[label], runId);
      assert.equal(current.Name, "/" + owned.name);
      assert.equal(current.Image, owned.imageId);
      if (current.State.Running) await docker("stop", "--time", "10", owned.id);
      await docker("rm", owned.id);
    } catch (error) { cleanupErrors.push(redact(error.message)); }
  }
  if (networkCreated) {
    try {
      const current = JSON.parse((await docker("network", "inspect", network)).stdout)[0];
      assert.equal(current.Labels[label], runId);
      assert.equal(current.Name, network);
      assert.equal(Object.keys(current.Containers ?? {}).length, 0);
      await docker("network", "rm", network);
    } catch (error) { cleanupErrors.push(redact(error.message)); }
  }
  const filter = "label=" + label + "=" + runId;
  try {
    assert.equal((await docker("ps", "--all", "--quiet", "--filter", filter)).stdout.trim(), "");
    assert.equal((await docker("network", "ls", "--quiet", "--filter", filter)).stdout.trim(), "");
    assert.equal((await docker("volume", "ls", "--quiet", "--filter", filter)).stdout.trim(), "");
  } catch (error) { cleanupErrors.push(redact(error.message)); }
  report.cleanupErrors = cleanupErrors;
  report.cleaned = cleanupErrors.length === 0;
  report.finishedAt = new Date().toISOString();
  await save();
  assert.equal(report.cleaned, true, "The owned API run did not clean up.");
}
if (failure) throw new Error(redact(failure.message));
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length,
  sourceRevision: report.sourceRevision, imageId, shutdown: report.shutdown, cleaned: report.cleaned }));
