import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A fresh project and internal networks with no published ports. Never load .env.
assert.equal(process.platform, "linux", "Use a disposable local Linux Docker runner.");
const root = fileURLToPath(new URL("../", import.meta.url));
const runId = randomBytes(8).toString("hex");
const project = `unfreq-pilot-${runId}`;
const network = `${project}-proxy`;
const label = "com.unfreq.pilot-acceptance";
const directory = path.join(root, "test-results/pilot-compose", runId);
await mkdir(directory, { recursive: true });
const envFile = path.join(directory, "isolated.env");
const override = path.join(directory, "compose.override.json");
const report = { runId, project,
  sourceCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  checks: [], passed: false, cleaned: false, cleanupErrors: [] };
const secrets = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
const allowed = /^(PATH|HOME|USERPROFILE|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_CERT_PATH|DOCKER_TLS_VERIFY)$/iu;
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
childEnv.UNFREQ_API_ENV_FILE = envFile;
const redact = (text) => secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text);
function docker(args, { timeout = 60_000, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { cwd: root, env: childEnv, encoding: "utf8", timeout,
    windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure) assert.ok(!result.error && result.status === 0,
    `docker ${args[0]} failed: ${redact(result.stderr ?? "")}`);
  return result;
}
const compose = (args, options) => docker(["compose", "--project-name", project, "--env-file", envFile,
  "--file", path.join(root, "compose.yaml"), "--file", override, ...args], options);
const check = (name) => { report.checks.push(name); console.log(`Passed: ${name}`); };
let networkCreated = false;
let creationAttempted = false;
let failure;
try {
  const contextName = docker(["context", "show"]).stdout.trim();
  const context = JSON.parse(docker(["context", "inspect", contextName]).stdout)[0];
  assert.match(context.Endpoints?.docker?.Host ?? "", /^unix:\/\/\//u);
  if (childEnv.DOCKER_HOST) assert.match(childEnv.DOCKER_HOST, /^unix:\/\/\//u);
  const policy = JSON.parse(await readFile(path.join(root, "deploy/abuse-policy.example.json"), "utf8"));
  policy.namespace = project;
  const paid = ["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"];
  for (const [name, budget] of Object.entries(policy.budgets)) {
    assert.equal(budget.limit, 0);
    budget.limit = paid.includes(name) ? 0 : 100;
    if (["generationDailyUser", "generationDailySite", "audioNewDailySite"].includes(name)) budget.windowMs = 86_400_000;
  }
  assert.equal(Object.keys(policy.budgets).length, 26);
  const replacements = { SESSION_SECRET: secrets[0], PROVIDER_CONFIG_SECRET: secrets[1],
    ABUSE_LIMITS_JSON: JSON.stringify(policy), WEB_ORIGIN: "https://isolated-pilot.test",
    UNFREQ_PROXY_NETWORK: network, AI_SIGNAL_SCHEDULER_ENABLED: "false" };
  const template = await readFile(path.join(root, ".env.example"), "utf8");
  await writeFile(envFile, template.split(/\r?\n/u).map((line) => {
    const key = line.split("=", 1)[0];
    return Object.hasOwn(replacements, key) ? `${key}=${replacements[key]}` : line;
  }).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(override, JSON.stringify({ networks: {
    app: { internal: true }, npm_default: { name: network },
  } }), { flag: "wx" });
  docker(["network", "create", "--internal", "--label", `${label}=${runId}`, network]);
  networkCreated = true;
  const config = JSON.parse(compose(["config", "--format", "json"]).stdout);
  const apiEnv = config.services.api.environment;
  assert.equal(apiEnv.AI_SIGNAL_SCHEDULER_ENABLED, "false");
  assert.equal(apiEnv.ABUSE_PROTECTION_ENABLED, "true");
  for (const name of ["AI_API_KEY", "AI_FAST_API_KEY", "EMBEDDING_API_KEY", "RERANKER_API_KEY", "TTS_API_KEY"]) assert.ok(!apiEnv[name]);
  for (const name of paid) assert.equal(JSON.parse(apiEnv.ABUSE_LIMITS_JSON).budgets[name].limit, 0);
  for (const service of Object.values(config.services)) assert.ok(!service.ports?.length);
  check("actual Compose configuration uses the complete 26-rule policy, no paid keys, disabled scheduler and no published ports");
  const build = compose(["build"], { timeout: 1_500_000, allowFailure: true });
  await writeFile(path.join(directory, "build.log"), redact((build.stdout ?? "") + (build.stderr ?? "")));
  assert.ok(!build.error && build.status === 0, "Compose image build failed; see build.log.");
  creationAttempted = true;
  compose(["up", "--detach", "--wait", "--wait-timeout", "180"], { timeout: 240_000 });
  const services = compose(["ps", "--services", "--status", "running"]).stdout.trim().split(/\s+/u).sort();
  assert.deepEqual(services, ["api", "postgres", "proxy", "redis", "web"]);
  // Internal Docker networks intentionally do not publish host ports. Exercise
  // the actual proxy from an owned container without weakening that isolation.
  const probe = compose(["exec", "-T", "api", "node", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const statuses = {};
    for (const target of ['/health', '/health/deep', '/web-health', '/galaxy']) {
      const response = await fetch('http://proxy' + target, { signal: AbortSignal.timeout(15000) });
      statuses[target] = response.status;
      assert.equal(response.status, 200, target + ' failed through actual Caddy');
      if (target === '/health/deep') assert.deepEqual((await response.json()).data.dependencies, { postgres: 'ok', redis: 'ok' });
      else await response.arrayBuffer();
    }
    const receipt = await fetch('http://proxy/api/reports/signal/00000000-0000-4000-8000-000000000001', { signal: AbortSignal.timeout(5000) });
    assert.equal(receipt.status, 401);
    assert.equal((await receipt.json()).error.code, 'UNAUTHORIZED');
    console.log(JSON.stringify({ statuses, privateReportStatus: receipt.status }));
  `], { timeout: 90_000 });
  report.proxy = JSON.parse(probe.stdout);
  const ledger = compose(["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "unfreq", "-At", "-c",
    "select count(*) from drizzle.__drizzle_migrations"]).stdout.trim();
  assert.equal(ledger, "25");
  check("all five real Compose services become healthy; Caddy serves Web/API, private report receipts require login and only 25 C1 migrations run");
  report.policy = { rules: 26, paidLimits: 0, schedulerEnabled: false };
  report.passed = true;
} catch (error) {
  failure = error;
} finally {
  if (creationAttempted) {
    const logs = compose(["logs", "--no-color"], { allowFailure: true });
    await writeFile(path.join(directory, "services.log"), redact((logs.stdout ?? "") + (logs.stderr ?? "")));
    const down = compose(["down", "--volumes", "--timeout", "40"], { timeout: 100_000, allowFailure: true });
    if (down.error || down.status !== 0) report.cleanupErrors.push("Compose teardown failed");
  }
  if (networkCreated) {
    const inspected = JSON.parse(docker(["network", "inspect", network]).stdout)[0];
    assert.equal(inspected.Labels[label], runId);
    const removed = docker(["network", "rm", network], { allowFailure: true });
    if (removed.error || removed.status !== 0) report.cleanupErrors.push("Proxy network teardown failed");
  }
  for (const resource of ["container", "network", "volume"]) {
    const remaining = docker([resource, "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], { allowFailure: true });
    if (remaining.error || remaining.status !== 0 || remaining.stdout.trim()) report.cleanupErrors.push(`${resource} remains or cannot be verified`);
  }
  await rm(envFile, { force: true });
  report.cleaned = report.cleanupErrors.length === 0;
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
if (failure) throw failure;
assert.equal(report.cleaned, true, "Compose resources were not fully cleaned.");
