import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// This deliberately small verifier has no F4 builder/resume dependencies.
const root = fileURLToPath(new URL("../", import.meta.url));
const runId = randomBytes(12).toString("hex");
const prefix = `unfreq-migrate-${runId}`;
const label = "com.unfreq.migration-image-run";
const image = `${prefix}:candidate`;
const network = `${prefix}-network`;
const evidence = path.join(root, "test-results/runtime-migration-image", runId);
await mkdir(evidence, { recursive: true });
const report = { runId, passed: false, checks: [], cleanupErrors: [], cleaned: false };
const containers = [];
let networkCreated = false;
let imageCreated = false;

function run(command, args, { timeout = 60_000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout,
    windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (!allowFailure) {
    assert.equal(result.error, undefined, `${command} could not finish.`);
    assert.equal(result.signal, null, `${command} was terminated.`);
    assert.equal(result.status, 0, `${command} ${args[0]} failed.`);
  }
  return result;
}
const docker = (args, options) => run("docker", args, options);
const check = (name) => { report.checks.push(name); console.log(`Passed: ${name}`); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonDocker = (args) => JSON.parse(docker(args).stdout);
async function waitFor(checker, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (checker()) return;
    assert.ok(Date.now() < deadline, "An isolated service failed to become ready.");
    await delay(250);
  }
}
function create(role, serviceImage, options = [], command = []) {
  const name = `${prefix}-${role}`;
  const id = docker(["run", "--detach", "--name", name, "--label", `${label}=${runId}`,
    "--network", network, "--network-alias", role, ...options, serviceImage, ...command]).stdout.trim();
  assert.match(id, /^[a-f0-9]{64}$/u);
  containers.push(id);
  return id;
}
function inspect(id) {
  const [value] = jsonDocker(["container", "inspect", id]);
  assert.equal(value.Config.Labels[label], runId);
  assert.ok(value.Name.startsWith(`/${prefix}-`));
  return value;
}
const exec = (id, args, options) => docker(["exec", id, ...args], options);
const probe = (id, source, options) => exec(id, ["node", "--input-type=module", "-e", source], options);
const apiReady = (id) => probe(id, "const r=await fetch('http://127.0.0.1:4000/health',{signal:AbortSignal.timeout(1000)});if(r.status!==200)process.exit(1);", { allowFailure: true }).status === 0;
const ownedPaths = run("git", ["ls-files", "--cached", "-z"]).stdout.split("\0").filter((name) =>
  [".dockerignore", "Dockerfile.api", "package.json", "package-lock.json", "apps/web/package.json",
    "scripts/apply-postgres-startup-patch.mjs", "scripts/api-entrypoint.sh",
    "scripts/verify-api-migration-image.mjs"].includes(name) || /^(apps\/api\/|packages\/contracts\/|patches\/)/u.test(name)).sort();
const hashes = async () => Object.fromEntries(await Promise.all(ownedPaths.map(async (name) => {
  const filename = path.join(root, name);
  const info = await lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  return [name, hash(await readFile(filename))];
})));
const inputs = await hashes();
report.sourceCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();
report.sourceTreeSha256 = hash(JSON.stringify(inputs));
await writeFile(path.join(evidence, "inputs.json"), JSON.stringify(inputs, null, 2) + "\n");

try {
  assert.equal(process.platform, "linux", "This verification requires a Linux Docker host.");
  const build = docker(["build", "--platform", "linux/amd64", "--file", "Dockerfile.api", "--target", "runner",
    "--label", `${label}=${runId}`, "--label", `org.opencontainers.image.revision=${report.sourceCommit}`,
    "--label", `com.unfreq.migration-source=${report.sourceTreeSha256}`, "--tag", image, "."], { timeout: 900_000, allowFailure: true });
  await writeFile(path.join(evidence, "build.log"), build.stdout + build.stderr);
  assert.equal(build.error, undefined, "The actual API image build did not finish.");
  assert.equal(build.status, 0, "The actual API image build failed; see the saved log.");
  imageCreated = true;
  const [built] = jsonDocker(["image", "inspect", image]);
  assert.equal(built.Config.Labels[label], runId);
  assert.equal(built.Config.Labels["org.opencontainers.image.revision"], report.sourceCommit);
  assert.equal(built.Config.Labels["com.unfreq.migration-source"], report.sourceTreeSha256);
  assert.equal(built.Os, "linux"); assert.equal(built.Architecture, "amd64");
  report.imageId = built.Id;
  check("real Dockerfile.api runner built with the frozen source identity");
  docker(["network", "create", "--internal", "--label", `${label}=${runId}`, network]);
  networkCreated = true;
  const password = randomBytes(24).toString("hex");
  const pg = create("postgres", "pgvector/pgvector:pg17", ["--tmpfs", "/var/lib/postgresql/data", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=unfreq_migration_image"]);
  const redis = create("redis", "redis:7-alpine", ["--tmpfs", "/data"]);
  await waitFor(() => exec(pg, ["pg_isready", "-U", "postgres", "-d", "unfreq_migration_image"], { allowFailure: true }).status === 0);
  await waitFor(() => exec(redis, ["redis-cli", "ping"], { allowFailure: true }).stdout.trim() === "PONG");
  const providerSource = `import http from 'node:http';let count=0;http.createServer((req,res)=>{if(req.url==='/received'){res.end(String(count));return;}if(req.method==='POST'){count++;req.resume();return;}res.writeHead(404).end();}).listen(8080,'0.0.0.0');`;
  create("provider", built.Id, ["--entrypoint", "node"], ["--input-type=module", "-e", providerSource]);
  const ruleNames = ["registerIp", "registerSite", "passwordRequestIp", "passwordRequestSite", "passwordFailureIp", "passwordFailureIdentityIp", "emailRequestIp", "emailRequestSite", "emailVerifyIp", "emailVerifySite", "generationRequestUser", "generationDailyUser", "generationDailySite", "audioReadIp", "audioRequestIp", "audioNewIp", "audioNewDailySite", "diagnosticIp", "diagnosticSite", "chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"];
  const paid = new Set(["embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"]);
  const policy = { namespace: `migration-${runId}`, budgets: Object.fromEntries(ruleNames.map((name) => [name, { limit: paid.has(name) ? 0 : 100, windowMs: 60_000 }])), pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000 };
  const env = { NODE_ENV: "production", API_HOST: "0.0.0.0", WEB_ORIGIN: "https://migration-image.example",
    DATABASE_URL: `postgres://postgres:${password}@postgres:5432/unfreq_migration_image`, REDIS_URL: "redis://redis:6379",
    SESSION_SECRET: randomBytes(32).toString("hex"), PROVIDER_CONFIG_SECRET: randomBytes(32).toString("hex"),
    AUTH_LOGIN_DELIVERY_MODE: "disabled", AUTH_LOGIN_CODE_RESPONSE: "disabled", ABUSE_PROTECTION_ENABLED: "true", ABUSE_LIMITS_JSON: JSON.stringify(policy),
    AI_API_KEY: "synthetic-migration-image-provider-key", AI_BASE_URL: "http://provider:8080/v1", AI_MODEL: "synthetic-held-model", AI_PROVIDER: "openai-compatible",
    SIGNAL_GENERATION_WORKER_ENABLED: "true", SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS: "25000", SIGNAL_GENERATION_LEASE_MS: "10000", SIGNAL_GENERATION_HEARTBEAT_MS: "1000",
    SIGNAL_GENERATION_SCAN_INTERVAL_MS: "25", DOTENV_CONFIG_QUIET: "true", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  const api = create("api", built.Id, Object.entries(env).flatMap(([name, value]) => ["--env", `${name}=${value}`]));
  await waitFor(() => apiReady(api));
  check("production entrypoint migrated a fresh database before serving HTTP");
  const packageProbe = probe(api, `import assert from 'node:assert/strict';import fs from 'node:fs';import{createRequire}from'node:module';const require=createRequire(import.meta.url);for(const name of ['drizzle-kit','@esbuild-kit/core-utils','@esbuild-kit/esm-loader']){assert.equal(fs.existsSync('/app/node_modules/'+name),false);}assert.equal(JSON.parse(fs.readFileSync('/app/node_modules/postgres/package.json')).version,'3.4.9');const command=fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean);assert.deepEqual(command,['node','dist/server.js']);console.log(JSON.stringify({driver:'3.4.9',pid1:command,developmentToolkitAbsent:true}));`);
  report.packages = JSON.parse(packageProbe.stdout);
  check("omit-dev runner excludes the toolkit and keeps postgres 3.4.9; Node is PID 1");
  const query = (sql) => exec(pg, ["psql", "-U", "postgres", "-d", "unfreq_migration_image", "-At", "-c", sql]).stdout.trim();
  const ledgerSql = "select json_agg(t)::text from (select id,hash,created_at from drizzle.__drizzle_migrations order by id) t";
  const ledger = query(ledgerSql);
  assert.equal(JSON.parse(ledger).length, 24);
  const rerun = exec(api, ["npm", "run", "api:migrate"]);
  assert.match(rerun.stdout, /Database migrations completed\./u);
  assert.equal(query(ledgerSql), ledger);
  check("the bundled compiled CLI is idempotent on the original 24-entry ledger");
  const blank = docker(["exec", "--env", "DATABASE_URL=", api, "node", "apps/api/dist/scripts/migrate.js"], { allowFailure: true });
  assert.equal(blank.status, 1); assert.equal(blank.stdout, ""); assert.equal(blank.stderr, "Database migration failed.\n");
  check("the production CLI rejects an empty URL with bounded fixed failure output");
  const submitted = probe(api, `import assert from'node:assert/strict';const auth=await fetch('http://127.0.0.1:4000/api/auth/frequency/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'synthetic-image-password'})});assert.equal(auth.status,201);const cookie=auth.headers.get('set-cookie').split(';')[0];const made=await fetch('http://127.0.0.1:4000/api/signals',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({seedText:'Only this synthetic migration-image signal is held for shutdown.'})});assert.ok([201,202].includes(made.status));const id=(await made.json()).data.signal.id;assert.match(id,/^[a-f0-9-]{36}$/);console.log(JSON.stringify({id}));`);
  const { id } = JSON.parse(submitted.stdout);
  const providerCount = () => Number(probe(api, "console.log(await(await fetch('http://provider:8080/received')).text());").stdout.trim());
  await waitFor(() => providerCount() > 0, 10_000);
  const count = providerCount();
  const started = Date.now();
  docker(["stop", "--time", "15", api], { timeout: 20_000 });
  const elapsedMs = Date.now() - started;
  const stopped = inspect(api);
  assert.equal(stopped.State.ExitCode, 0); assert.equal(stopped.State.OOMKilled, false); assert.ok(elapsedMs < 25_000);
  const stateSql = `select json_build_object('status',generation_status,'attempt',generation_attempt_count,'owner',generation_lease_owner,'until',generation_lease_until)::text from signals where id='${id}'`;
  const state = query(stateSql);
  const parsed = JSON.parse(state);
  assert.equal(parsed.status, "FAILED"); assert.equal(parsed.owner, null); assert.equal(parsed.until, null);
  report.activeShutdown = { elapsedMs, exitCode: stopped.State.ExitCode, oomKilled: false, state: parsed };
  check("SIGTERM during an actual held provider request exits naturally before its 25-second attempt deadline");
  docker(["start", api]); await waitFor(() => apiReady(api)); await delay(750);
  assert.equal(query(stateSql), state); assert.equal(providerCount(), count); assert.equal(query(ledgerSql), ledger);
  check("the same container restarts without replaying the stopped generation or changing the ledger");
  docker(["stop", "--time", "15", api], { timeout: 20_000 });
  assert.equal(inspect(api).State.ExitCode, 0); assert.equal(inspect(api).State.OOMKilled, false);
  assert.deepEqual(await hashes(), inputs);
  report.sourceVerified = true;
  check("all frozen build inputs remain unchanged through the real image verification");
  report.passed = true;
} catch (error) {
  report.failure = String(error?.message ?? error);
  console.error(report.failure);
} finally {
  for (const id of containers.reverse()) {
    try {
      const value = inspect(id);
      const logs = docker(["logs", id], { allowFailure: true });
      await writeFile(path.join(evidence, `${value.Name.slice(1)}.log`), logs.stdout + logs.stderr);
      if (value.State.Running) docker(["stop", "--time", "15", id], { timeout: 20_000 });
      docker(["container", "rm", "--volumes", id]);
    } catch { report.cleanupErrors.push("Owned container cleanup failed."); }
  }
  if (networkCreated) {
    try {
      const [value] = jsonDocker(["network", "inspect", network]); assert.equal(value.Labels[label], runId);
      docker(["network", "rm", network]);
    } catch { report.cleanupErrors.push("Owned network cleanup failed."); }
  }
  if (imageCreated) {
    try { const [value] = jsonDocker(["image", "inspect", image]); assert.equal(value.Config.Labels[label], runId); docker(["image", "rm", image]); }
    catch { report.cleanupErrors.push("Owned image cleanup failed."); }
  }
  const leftContainers = docker(["container", "ls", "--all", "--quiet", "--filter", `label=${label}=${runId}`], { allowFailure: true });
  const leftNetworks = docker(["network", "ls", "--quiet", "--filter", `label=${label}=${runId}`], { allowFailure: true });
  report.cleaned = report.cleanupErrors.length === 0 && leftContainers.status === 0 && leftNetworks.status === 0 && !leftContainers.stdout.trim() && !leftNetworks.stdout.trim();
  report.passed = report.passed && report.cleaned;
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, sourceVerified: report.sourceVerified ?? false, cleaned: report.cleaned, evidence }));
  if (!report.passed) process.exitCode = 1;
}
