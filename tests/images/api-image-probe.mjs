import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Invoked with docker exec only inside the verifier's disposable final image.
// It uses its synthetic database and Redis, never the user's production data.
assert.equal(process.platform, "linux");
assert.equal(process.cwd(), "/app");
assert.match(process.env.UNFREQ_IMAGE_VERIFICATION_RUN ?? "", /^[a-f0-9]{24}$/u);
assert.equal(process.env.NODE_ENV, "production");
assert.equal(process.env.ABUSE_PROTECTION_ENABLED, "true");
assert.equal(process.env.AUTH_LOGIN_DELIVERY_MODE, "disabled");
assert.equal(process.env.AUTH_LOGIN_CODE_RESPONSE, "disabled");
assert.equal(process.env.AI_SIGNAL_SCHEDULER_ENABLED, "false");
assert.equal(process.env.SIGNAL_GENERATION_WORKER_ENABLED, "false");
const databaseUrl = new URL(process.env.DATABASE_URL);
const redisUrl = new URL(process.env.REDIS_URL);
assert.equal(databaseUrl.hostname, "postgres");
assert.equal(databaseUrl.pathname, "/unfreq_image");
assert.equal(redisUrl.hostname, "redis");
for (const key of ["AI_API_KEY", "AI_FAST_API_KEY", "EMBEDDING_API_KEY", "RERANKER_API_KEY", "TTS_API_KEY"]) {
  assert.equal(process.env[key] ?? "", "", "Real provider credentials are refused");
}

const require = createRequire("/app/package.json");
const postgres = (await import(pathToFileURL(require.resolve("postgres")).href)).default;
const Redis = require("ioredis").Redis;
const sql = postgres(process.env.DATABASE_URL, { infer: true, max: 1, connect_timeout: 3 });
const redis = new Redis(process.env.REDIS_URL, {
  connectTimeout: 3000, commandTimeout: 3000, lazyConnect: true,
  maxRetriesPerRequest: 0, retryStrategy: () => null,
});
redis.on("error", () => {});
const checks = [];
const check = async (name, work) => { await work(); checks.push(name); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const base = `http://127.0.0.1:${process.env.API_PORT ?? "4000"}`;
async function request(route, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${route}`, {
    method, redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.equal(typeof value.meta?.requestId, "string", "Expected request envelope");
  return { response, value };
}
function assertError(result, status, code) {
  assert.equal(result.response.status, status);
  assert.equal(result.value.error?.code, code);
  assert.equal(result.value.data, undefined);
}
function sessionCookie(result) {
  const header = result.response.headers.get("set-cookie");
  assert.ok(header);
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) assert.ok(header.includes(attribute));
  assert.match(header, /^unfreq_session=.+; /u);
  return header.split(";", 1)[0];
}

let journal;
let patchHashes;
let frequencyId;
let frequencyCode;
let cookie;
const password = `synthetic-${randomBytes(20).toString("hex")}`;
try {
  await check("production configuration and paid budgets", async () => {
    const { env } = await import("/app/apps/api/dist/config/env.js");
    assert.equal(env.isProduction, true);
    assert.equal(env.abusePolicy.enabled, true);
    assert.equal(env.abusePolicy.configured, true);
    for (const name of ["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"]) {
      assert.equal(env.abusePolicy.budgets[name].limit, 0);
    }
  });
  await check("postgres ESM and CommonJS share default function", async () => {
    assert.equal(typeof postgres, "function");
    assert.equal(require("postgres").default, postgres);
  });
  await check("postgres exact version and installed patch hashes", async () => {
    const metadata = JSON.parse(await readFile("/tmp/postgres-lifecycle.json", "utf8"));
    const packageRoot = path.dirname(path.dirname(require.resolve("postgres")));
    const installed = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    assert.equal(metadata.package, "postgres");
    assert.equal(installed.version, metadata.version);
    patchHashes = {};
    for (const file of metadata.files) {
      const absolute = path.resolve(packageRoot, file.path);
      assert.ok(absolute.startsWith(packageRoot + path.sep));
      patchHashes[file.path] = sha(await readFile(absolute));
      assert.equal(patchHashes[file.path], file.patchedSha256);
    }
    assert.equal(Object.keys(patchHashes).length, 2);
  });
  await check("contracts runtime exports", async () => {
    const contracts = await import(pathToFileURL(require.resolve("@unfreq/contracts")).href);
    assert.ok(Array.isArray(contracts.signalGenerationStatuses));
    assert.ok(contracts.signalGenerationStatuses.includes("COMPLETED"));
  });
  await check("development sources and credentials absent from image", async () => {
    for (const relative of [".env", ".env.local", ".git", "test-results", "tests", "apps/api/src/server.ts", "apps/web/src"]) {
      await assert.rejects(lstat(path.join("/app", relative)), { code: "ENOENT" });
    }
  });
  await check("production migration CLI excludes the development toolkit", async () => {
    const apiPackage = JSON.parse(await readFile("/app/apps/api/package.json", "utf8"));
    assert.equal(apiPackage.scripts.migrate, "node dist/scripts/migrate.js");
    assert.equal(apiPackage.dependencies["drizzle-kit"], undefined);
    assert.ok(apiPackage.devDependencies["drizzle-kit"]);
    assert.equal((await lstat("/app/apps/api/dist/scripts/migrate.js")).isFile(), true);
    for (const relative of ["node_modules/drizzle-kit", "node_modules/@esbuild-kit/esm-loader",
      "node_modules/@esbuild-kit/core-utils", "apps/api/drizzle.config.ts"]) {
      await assert.rejects(lstat(path.join("/app", relative)), { code: "ENOENT" });
    }
  });
  await check("bundled migration CLI rejects blank URLs instead of using PG defaults", async () => {
    for (const empty of ["", " \t"]) {
      const result = spawnSync(process.execPath, ["/app/apps/api/dist/scripts/migrate.js"], {
        cwd: "/app/apps/api", encoding: "utf8", timeout: 5000,
        env: { ...process.env, DATABASE_URL: empty, PGHOST: databaseUrl.hostname,
          PGPORT: databaseUrl.port || "5432", PGUSER: decodeURIComponent(databaseUrl.username),
          PGPASSWORD: decodeURIComponent(databaseUrl.password), PGDATABASE: databaseUrl.pathname.slice(1),
          DOTENV_CONFIG_PATH: "/tmp/absent-owned-migration.env", DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_OVERRIDE: "false" },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "Database migration failed.\n");
    }
  });
  await check("all bundled migrations applied to empty synthetic database", async () => {
    journal = JSON.parse(await readFile("/app/apps/api/src/db/migrations/meta/_journal.json", "utf8"));
    const [row] = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    assert.equal(row.count, journal.entries.length);
    const [extension] = await sql`select extname from pg_extension where extname = 'vector'`;
    assert.equal(extension?.extname, "vector");
    const [scheduler] = await sql`select to_regclass('public.ai_signal_scheduler_batches')::text as table_name`;
    assert.equal(scheduler.table_name, "ai_signal_scheduler_batches");
  });
  await check("real Redis responds", async () => {
    await redis.connect();
    assert.equal(await redis.ping(), "PONG");
  });
  await check("HTTP liveness and dependency health", async () => {
    const health = await request("/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.value.data.status, "ok");
    assert.equal(health.value.data.service, "api");
    const deep = await request("/health/deep");
    assert.equal(deep.response.status, 200);
    assert.deepEqual(deep.value.data.dependencies, { postgres: "ok", redis: "ok" });
  });
  await check("anonymous private identity denied and uncached", async () => {
    const result = await request("/api/me");
    assertError(result, 401, "UNAUTHORIZED");
    assert.match(result.response.headers.get("cache-control"), /private, no-store/u);
  });
  await check("unknown expression does not disclose an object", async () => {
    assertError(await request(`/api/signals/${randomUUID()}`), 404, "NOT_FOUND");
  });
  await check("production email request and verification disabled", async () => {
    for (const [route, body] of [["/api/auth/login", { email: "synthetic-image@example.invalid" }],
      ["/api/auth/login/verify", { email: "synthetic-image@example.invalid", code: "123456" }]]) {
      const result = await request(route, { method: "POST", body });
      assertError(result, 403, "FORBIDDEN");
      for (const key of ["challenge", "delivery", "localDelivery", "sessionToken"]) assert.equal(result.value[key], undefined);
    }
    assert.deepEqual(await redis.keys("auth:login:challenge:*"), []);
  });
  await check("password registration and secure session cookie", async () => {
    const result = await request("/api/auth/register", { method: "POST", body: { password } });
    assert.equal(result.response.status, 201);
    assert.equal(result.value.data.isNewFrequency, true);
    assert.equal(result.value.data.frequency.role, "USER");
    assert.equal(result.value.data.frequency.isGuest, false);
    frequencyId = result.value.data.frequency.id;
    frequencyCode = result.value.data.frequency.freqCode;
    assert.match(frequencyId, /^[a-f0-9-]{36}$/u);
    assert.match(frequencyCode, /^FM \d{2}\.\d{2}$/u);
    cookie = sessionCookie(result);
  });
  await check("registered identity and mirror persisted transactionally", async () => {
    const [row] = await sql`select u.id, u.freq_code, u.is_guest, u.password_hash,
      f.code, f.is_guest as mirror_guest, f.password_hash = u.password_hash as same_password
      from users u join frequencies f on f.id = u.id where u.id = ${frequencyId}::uuid`;
    assert.equal(row.id, frequencyId);
    assert.equal(row.freq_code, frequencyCode);
    assert.equal(row.code, frequencyCode);
    assert.equal(row.is_guest, false);
    assert.equal(row.mirror_guest, false);
    assert.equal(row.same_password, true);
    assert.ok(row.password_hash.startsWith("scrypt:"));
    assert.ok(!row.password_hash.includes(password));
  });
  await check("authenticated HTTP identity read", async () => {
    const result = await request("/api/me", { cookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.value.data.frequency.id, frequencyId);
  });
  await check("ordinary user admin access denied", async () => {
    assertError(await request("/api/admin/overview", { cookie }), 403, "FORBIDDEN");
  });
  await check("wrong password denied", async () => {
    const result = await request("/api/auth/frequency/login", {
      method: "POST", body: { frequencyCode, password: `${password}-wrong` },
    });
    assertError(result, 401, "UNAUTHORIZED");
    assert.equal(result.response.headers.get("set-cookie"), null);
  });
  await check("password login reuses registered identity", async () => {
    const result = await request("/api/auth/frequency/login", { method: "POST", body: { frequencyCode, password } });
    assert.equal(result.response.status, 200);
    assert.equal(result.value.data.isNewFrequency, false);
    assert.equal(result.value.data.frequency.id, frequencyId);
    cookie = sessionCookie(result);
    const me = await request("/api/me", { cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.value.data.frequency.id, frequencyId);
  });
  await check("logout clears browser cookie", async () => {
    const result = await request("/api/auth/logout", { method: "POST", cookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.value.data.ok, true);
    const cleared = result.response.headers.get("set-cookie");
    assert.ok(cleared.startsWith("unfreq_session=;"));
    assert.ok(cleared.includes("Max-Age=0"));
    assert.ok(cleared.includes("Secure"));
    // Logout is cookie clearing, not server-side revocation of stateless tokens.
    assertError(await request("/api/me"), 401, "UNAUTHORIZED");
  });
  console.log(JSON.stringify({ syntheticOnly: true, node: process.versions.node, platform: process.platform,
    arch: process.arch, passed: checks.length, checks, migrationCount: journal.entries.length,
    postgresPatchHashes: patchHashes, paidProviderCallsRequested: 0,
    limitations: ["Synthetic account, production-mode API and disposable PostgreSQL/Redis only.",
      "No real provider, production data, target deployment, physical device or model quality acceptance.",
      "Logout proves browser cookie clearing; it does not revoke previously issued stateless session tokens."] }));
} finally {
  redis.disconnect();
  await sql.end({ timeout: 2 });
}
