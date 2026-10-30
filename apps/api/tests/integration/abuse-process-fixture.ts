import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { ruleNames, type AbuseRuleName } from "../../src/config/abuse.js";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";
import { fixtureSeed } from "./fixtures.js";

export const abuseCases = ["register", "trusted", "password", "email", "disabled", "production", "diagnostic",
  "generation", "generationfailed", "request", "daily", "providerchat", "providerembedding", "providerreranker", "providertts", "redisfault", "audio", "audiostop", "audiofault"] as const;
export type AbuseCase = typeof abuseCases[number];
export function syntheticAbusePolicy(caseId: AbuseCase, namespace: string) {
  const budgets = Object.fromEntries(ruleNames.map((rule) => [rule, { limit: 1000, windowMs: 3_600_000 }])) as
    Record<AbuseRuleName, { limit: number; windowMs: number }>;
  for (const rule of ["generationDailyUser", "generationDailySite", "audioNewDailySite"] as const) budgets[rule].windowMs = 86_400_000;
  if (caseId === "register" || caseId === "trusted") budgets.registerIp.limit = 2;
  if (caseId === "password") { budgets.passwordFailureIdentityIp.limit = 2; budgets.passwordFailureIp.limit = 20; }
  if (caseId === "diagnostic") { budgets.diagnosticIp.limit = 2; budgets.diagnosticSite.limit = 3; }
  if (caseId === "daily") budgets.generationDailyUser.limit = 2;
  if (caseId === "request") budgets.generationRequestUser.limit = 2;
  if (caseId === "generationfailed") budgets.chatCallsSite.limit = 0;
  if (caseId === "production") for (const rule of ["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"] as const) budgets[rule].limit = 0;
  if (caseId.startsWith("provider")) {
    const kind: AbuseRuleName = caseId === "providerchat" ? "chatCallsSite" : caseId === "providerembedding" ? "embeddingCallsSite" :
      caseId === "providerreranker" ? "rerankerCallsSite" : "ttsCharactersSite";
    budgets[kind].limit = caseId === "providertts" ? 18 : 2;
  }
  // A stop case must not pass by waiting for the natural deadline (60s > the
  // owned shutdown RPC's 15s bound). The fault case deliberately expires at 2s.
  return { namespace, budgets, pendingPerUser: 1, ttsConcurrency: 1,
    ttsTaskTimeoutMs: caseId === "audiofault" ? 2000 : caseId === "audiostop" ? 60_000 : 5_000 };
}
export const abuseEmptyEnvironment = "# Owned B3 integration; no project dotenv.\n";
const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inject"), method: z.enum(["POST", "GET"]), url: z.string().max(160),
    cookie: z.string().max(2048).optional(), forwarded: z.enum(["198.51.100.1", "198.51.100.2", "198.51.100.3"]).optional(), remote: z.enum(["127.0.0.1", "127.0.0.2"]).optional(),
    payload: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ kind: z.literal("provider"), provider: z.enum(["chat", "embedding", "reranker", "tts"]) }).strict(),
  z.object({ kind: z.literal("preparechat"), cookie: z.string().max(2048) }).strict(),
  z.object({ kind: z.literal("email-service") }).strict(),
  z.object({ kind: z.literal("diagnostics") }).strict(), z.object({ kind: z.literal("shutdown") }).strict(),
]);
export type AbuseCommand = z.infer<typeof commandSchema>;
export type AbuseResponse = { statusCode: number; body: unknown; cookie?: string; retryAfter?: string };
export type AbuseMessage = { kind: "ready"; pid: number } | { kind: "boot"; phase: string; pid: number; at: number } |
  { kind: "reply"; id: number; ok: boolean; value?: unknown } | { kind: "fatal" };
const send = (message: AbuseMessage) => new Promise<void>((done, reject) => {
  if (!process.send || !process.connected) { reject(new Error("Owned B3 IPC closed.")); return; }
  process.send(message, (error) => error ? reject(error) : done());
});
async function main() {
  await send({ kind: "boot", phase: "validation-start", pid: process.pid, at: Date.now() });
  const env = process.env;
  const runId = env.UNFREQ_INTEGRATION_RUN_ID ?? "";
  const nonce = env.UNFREQ_ABUSE_NONCE ?? "";
  const caseId = z.enum(abuseCases).parse(env.UNFREQ_ABUSE_CASE);
  if (env.UNFREQ_INTEGRATION_MANAGED !== "1" || env.UNFREQ_ABUSE_FIXTURE !== "1" ||
    !/^[a-f0-9]{12}$/u.test(runId) || !/^[a-f0-9]{24}$/u.test(nonce) || Number(env.UNFREQ_ABUSE_PARENT_PID) !== process.ppid ||
    env.NODE_OPTIONS !== undefined || env.DOTENV_KEY !== undefined) throw new Error("Invalid B3 owner.");
  await verifyIntegrationRuntime({ entry: "abuse", runId, runtimeDirectory: env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "",
    ownershipToken: env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "", executingEntry: fileURLToPath(import.meta.url) });
  const name = `unfreq_integration_b3_${createHash("sha256").update(runId).digest("hex").slice(0, 10)}_${nonce.slice(0, 12)}`;
  const database = new URL(env.DATABASE_URL ?? "");
  const redis = new URL(env.REDIS_URL ?? "");
  const http = new URL(env.UNFREQ_ABUSE_HTTP ?? "");
  const ws = new URL(env.UNFREQ_ABUSE_WS ?? "");
  const port = (value: string) => /^\d+$/u.test(value) && +value >= 1024 && +value <= 65535 && ![5432, 6379].includes(+value);
  if (database.protocol !== "postgres:" || database.hostname !== "127.0.0.1" || !port(database.port) || database.pathname !== `/${name}` ||
    database.username !== "unfreq_test" || database.password !== "unfreq_integration_only" || database.search || database.hash ||
    redis.protocol !== "redis:" || redis.hostname !== "127.0.0.1" || !port(redis.port) || redis.username || redis.password || redis.search || redis.hash || redis.pathname !== "/0" ||
    http.protocol !== "http:" || http.hostname !== "127.0.0.1" || !port(http.port) || http.pathname !== "/" || http.username || http.password || http.search || http.hash ||
    ws.protocol !== "ws:" || ws.hostname !== "127.0.0.1" || ws.port !== http.port || ws.pathname !== "/tts" || ws.username || ws.password || ws.search || ws.hash ||
    new Set([database.port, redis.port, http.port]).size !== 3) throw new Error("Invalid owned B3 endpoints.");
  const expected: Record<string, string> = {
    ABUSE_PROTECTION_ENABLED: "true", ABUSE_LIMITS_JSON: JSON.stringify(syntheticAbusePolicy(caseId, `b3_${runId}_${nonce}`)),
    ABUSE_HMAC_SECRET: `abuse-budget-${nonce}`, SESSION_SECRET: `abuse-session-${nonce}`, PROVIDER_CONFIG_SECRET: `abuse-provider-${nonce}`,
    NODE_ENV: caseId === "production" ? "production" : "test", TRUSTED_PROXY_CIDRS: caseId === "trusted" ? "127.0.0.1/32" : "",
    AUTH_LOGIN_DELIVERY_MODE: ["disabled", "production"].includes(caseId) ? "disabled" : "local-log",
    AUTH_LOGIN_CODE_RESPONSE: ["disabled", "production"].includes(caseId) ? "disabled" : "enabled",
    AUTH_LOGIN_CHALLENGE_TTL_SECONDS: "60", AUTH_LOGIN_MAX_VERIFY_ATTEMPTS: "5", AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS: "1",
    AI_API_KEY: "abuse-stub-only", AI_BASE_URL: `${http.origin}/v1`, AI_PROVIDER: "integration-loopback", AI_MODEL: "synthetic-main",
    AI_FAST_API_KEY: "", AI_FAST_BASE_URL: "", AI_FAST_MODEL: "", AI_FAST_PROVIDER: "",
    EMBEDDING_API_KEY: ["providerembedding", "redisfault"].includes(caseId) ? "abuse-stub-only" : "", EMBEDDING_BASE_URL: ["providerembedding", "redisfault"].includes(caseId) ? `${http.origin}/v1` : "",
    EMBEDDING_DIMENSIONS: "1024", EMBEDDING_MODEL: "synthetic-embedding", EMBEDDING_PROVIDER: "integration-loopback", EMBEDDING_VERSION: "b3-synthetic-v1",
    RERANKER_API_KEY: ["providerreranker", "redisfault"].includes(caseId) ? "abuse-stub-only" : "", RERANKER_BASE_URL: ["providerreranker", "redisfault"].includes(caseId) ? `${http.origin}/v1` : "",
    RERANKER_PROVIDER: "integration-loopback", RERANKER_MODEL: "synthetic-reranker",
    TTS_API_KEY: "abuse-stub-only", TTS_BASE_URL: ws.toString(), TTS_PROVIDER: "integration-loopback", TTS_MODEL: "synthetic-tts", TTS_VOICE_LEFT: "synthetic", TTS_VOICE_RIGHT: "synthetic",
    SIGNAL_GENERATION_WORKER_ENABLED: ["generation", "generationfailed", "request", "daily", "audio", "audiostop", "audiofault"].includes(caseId) ? "true" : "false",
    SIGNAL_GENERATION_CONCURRENCY: "2", SIGNAL_GENERATION_SCAN_INTERVAL_MS: "50", SIGNAL_GENERATION_LEASE_MS: "2000", SIGNAL_GENERATION_HEARTBEAT_MS: "200",
    SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS: "10000", SIGNAL_GENERATION_MAX_ATTEMPTS: "3", SIGNAL_GENERATION_RETRY_BASE_MS: "50", SIGNAL_GENERATION_RETRY_MAX_MS: "500",
    SIGNAL_GENERATION_SHUTDOWN_GRACE_MS: "200", SIGNAL_GENERATION_DB_STATEMENT_TIMEOUT_MS: "5000", SIGNAL_GENERATION_DB_LOCK_TIMEOUT_MS: "1000",
    HEALTH_DEPENDENCY_TIMEOUT_MS: "500", DB_POOL_MAX: "4", LOG_LEVEL: "warn", IMAGE_MAX_BYTES: "2097152",
    WEB_ORIGIN: caseId === "production" ? "https://b3-synthetic.example" : "http://127.0.0.1:3200", API_HOST: "127.0.0.1", API_PORT: "4000",
  };
  for (const [key, value] of Object.entries(expected)) if (env[key] !== value) throw new Error("B3 synthetic configuration mismatch.");
  const directory = resolve(env.UNFREQ_ABUSE_DIRECTORY ?? "");
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(`unfreq-abuse-${nonce}-`) ||
    env.DOTENV_CONFIG_PATH !== join(directory, "empty.env") || env.IMAGE_STORAGE_DIR !== join(directory, "images") || env.TTS_STORAGE_DIR !== join(directory, "audio") ||
    await readFile(join(directory, "empty.env"), "utf8") !== abuseEmptyEnvironment) throw new Error("Invalid B3 media ownership.");
  await send({ kind: "boot", phase: "validation-complete", pid: process.pid, at: Date.now() });
  const originalFetch = globalThis.fetch;
  let blocked = 0;
  globalThis.fetch = (async (input, options) => {
    let url: URL;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); }
    catch { blocked += 1; throw new Error("B3 HTTP blocked."); }
    if (url.origin !== http.origin) { blocked += 1; throw new Error("B3 HTTP blocked."); }
    return originalFetch(input, { ...options, redirect: "error" });
  }) as typeof fetch;
  await send({ kind: "boot", phase: "db-guard-start", pid: process.pid, at: Date.now() });
  const guard = postgres(database.toString(), { max: 1, prepare: false, connect_timeout: 5 });
  try {
    const [identity] = await guard`select current_database() as name, current_user as owner`;
    const markers = await guard`select run_id, nonce, case_id from abuse_test_ownership`;
    const [owner] = await guard`select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()`;
    if (identity?.name !== name || identity.owner !== "unfreq_test" || owner?.owner !== "unfreq_test" || markers.length !== 1 ||
      markers[0].run_id !== runId || markers[0].nonce !== nonce || markers[0].case_id !== caseId || (await guard`select id from provider_configs`).length) throw new Error("B3 database guard failed.");
  } finally { await guard.end({ timeout: 0 }); }
  await send({ kind: "boot", phase: "db-guard-complete", pid: process.pid, at: Date.now() });
  await send({ kind: "boot", phase: "app-import-start", pid: process.pid, at: Date.now() });
  const { buildApp } = await import("../../src/app.js");
  await send({ kind: "boot", phase: "app-import-complete", pid: process.pid, at: Date.now() });
  const logs: string[] = [];
  let logBytes = 0;
  let unhandled = 0;
  let closing = false;
  await send({ kind: "boot", phase: "app-build-start", pid: process.pid, at: Date.now() });
  const app = await buildApp({ logger: { level: "warn", stream: { write(line: string) {
    logBytes += Buffer.byteLength(line); if (logBytes <= 65_536) logs.push(line);
  } } } });
  await send({ kind: "boot", phase: "app-build-complete", pid: process.pid, at: Date.now() });
  await send({ kind: "boot", phase: "app-ready-start", pid: process.pid, at: Date.now() });
  await app.ready();
  const fatal = () => { unhandled += 1; void send({ kind: "fatal" }).finally(() => process.exit(1)); };
  process.on("uncaughtException", fatal); process.on("unhandledRejection", fatal);
  process.once("disconnect", () => { if (!closing) process.exit(1); });
  const diagnostics = () => ({ blocked, unhandled, logOverflow: logBytes > 65_536,
    logLeaks: [fixtureSeed, "SYNTHETIC_B3_DIAGNOSTIC_MARKER", "abuse-stub-only", expected.SESSION_SECRET, expected.ABUSE_HMAC_SECRET].some((marker) => logs.join("").includes(marker)),
    diagnosticEvents: logs.filter((line) => line.includes('"action":"frontend.error.report"')).length });
  const registeredIds = new Set<string>();
  async function validateChatConfiguration() {
    if (caseId !== "providerchat") throw new Error("B3 chat configuration guard outside dedicated case.");
    const { db } = await import("../../src/db/client.js");
    const { providerConfigs, users } = await import("../../src/db/schema.js");
    const api = await import("../../src/modules/ai/provider-config.js");
    const rows = await db.select().from(providerConfigs);
    const authors = await db.select({ id: users.id }).from(users);
    const configs = await api.listProviderConfigsByKind("chat");
    const row = rows[0]; const config = configs[0];
    if (rows.length !== 1 || configs.length !== 1 || !row || !config || config.id !== row.id ||
      !/^[a-f0-9-]{36}$/u.test(row.id) || row.kind !== "chat" || row.baseUrl !== `${http.origin}/v1` ||
      row.model !== "synthetic-primary" || row.provider !== "integration-loopback" || row.priority !== 0 || row.isEnabled !== true ||
      authors.length !== 1 || row.updatedBy !== authors[0].id ||
      JSON.stringify(row.extraJson) !== JSON.stringify({ chatProfile: "default" }) || !row.apiKeyCiphertext || row.apiKeyLast4 !== "only" ||
      api.readProviderConfigApiKey(config, "") !== "abuse-stub-only") throw new Error("B3 owned chat configuration changed.");
  }
  async function execute(command: AbuseCommand): Promise<unknown> {
    if (closing) throw new Error("B3 child closing.");
    if (command.kind === "diagnostics") return diagnostics();
    if (command.kind === "shutdown") { closing = true; await app.close(); return diagnostics(); }
    if (command.kind === "preparechat") {
      if (caseId !== "providerchat") throw new Error("B3 chat preparation outside dedicated case.");
      const token = /^unfreq_session=([^;]+)$/u.exec(command.cookie)?.[1];
      const auth = await import("../../src/modules/auth/service.js");
      const author = token === undefined ? undefined : await auth.authenticateSessionToken(token);
      if (!author || !registeredIds.has(author.id) || author.status !== "ACTIVE" || author.isGuest !== false) throw new Error("B3 chat preparation requires its registered author.");
      const { db } = await import("../../src/db/client.js");
      const { providerConfigs } = await import("../../src/db/schema.js");
      if ((await db.select({ id: providerConfigs.id }).from(providerConfigs)).length !== 0) throw new Error("B3 chat preparation requires empty provider storage.");
      const api = await import("../../src/modules/ai/provider-config.js");
      await api.createProviderConfig({ updatedBy: author.id, config: {
        kind: "chat", baseUrl: `${http.origin}/v1`, provider: "integration-loopback", model: "synthetic-primary",
        extraJson: { chatProfile: "default" }, priority: 0, isEnabled: true, apiKey: "abuse-stub-only",
      } });
      await validateChatConfiguration();
      return { prepared: true };
    }
    if (command.kind === "email-service") {
      const auth = await import("../../src/modules/auth/service.js");
      const codes: string[] = [];
      for (const call of [() => auth.requestLoginChallenge(app.redis, "synthetic@example.com"), () => auth.verifyLoginChallenge(app.redis, { email: "synthetic@example.com", code: "123456" })]) {
        try { await call(); codes.push("ALLOWED"); } catch (error) { codes.push(error instanceof Error && "code" in error && error.code === "FORBIDDEN" ? "FORBIDDEN" : "OTHER"); }
      }
      return { codes };
    }
    if (command.kind === "provider") {
      if (caseId !== `provider${command.provider}` && caseId !== "redisfault") throw new Error("Provider command outside dedicated case.");
      if (caseId === "providerchat") await validateChatConfiguration();
      try {
        if (command.provider === "chat") await (await import("../../src/modules/ai/provider-transport.js")).callChatProvider("signal-fingerprint", fixtureSeed);
        if (command.provider === "embedding") await (await import("../../src/modules/ai/embedding.js")).generateEmbedding(fixtureSeed, { retryDelayMs: 0, timeoutMs: 1000 });
        if (command.provider === "reranker") await (await import("../../src/modules/ai/reranker.js")).rerankCandidates({ queryText: fixtureSeed,
          candidates: [{ id: "00000000-0000-4000-8000-000000000101", expandedText: fixtureSeed, distance: 0.1 }] });
        if (command.provider === "tts") await (await import("../../src/modules/ai/tts.js")).synthesize("synthetic", undefined, 1, { retryDelayMs: 0, timeoutMs: 1000, totalTimeoutMs: 3000, closeTimeoutMs: 200 });
        return { ok: true };
      } catch (error) { return { ok: false, limited: error instanceof Error && error.name === "AbuseControlStopped" }; }
    }
    const allowed = command.method === "GET" ? /^\/api\/signals\/[a-f0-9-]{36}(?:\/(?:publication-preview|audio(?:\/(?:main|left|right))?))?(?:\?v=\d{1,10})?$/u.test(command.url) :
      ["/api/auth/register", "/api/auth/frequency/login", "/api/auth/login", "/api/auth/login/verify", "/api/frontend-diagnostics/errors", "/api/signals"].includes(command.url) ||
      /^\/api\/signals\/[a-f0-9-]{36}\/(?:publish|withdraw|audio)$/u.test(command.url);
    if (!allowed) throw new Error("B3 route refused.");
    const response = await app.inject({ method: command.method, url: command.url,
      remoteAddress: command.remote ?? "127.0.0.1", headers: { ...(command.cookie ? { cookie: command.cookie } : {}), ...(command.forwarded ? { "x-forwarded-for": command.forwarded } : {}) },
      ...(command.payload === undefined ? {} : { payload: command.payload }) });
    const cookies = response.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies : [String(cookies ?? "")]).find((item) => item.startsWith("unfreq_session="))?.split(";")[0];
    const body = response.json<unknown>();
    if (command.method === "POST" && command.url === "/api/auth/register" && response.statusCode === 201) {
      registeredIds.add(z.object({ data: z.object({ frequency: z.object({ id: z.string().uuid() }) }) }).parse(body).data.frequency.id);
    }
    return { statusCode: response.statusCode, body, ...(cookie ? { cookie } : {}),
      ...(response.headers["retry-after"] ? { retryAfter: String(response.headers["retry-after"]) } : {}) } satisfies AbuseResponse;
  }
  process.on("message", (input: unknown) => {
    const message = z.object({ id: z.number().int().positive(), command: commandSchema }).strict().safeParse(input);
    if (!message.success || JSON.stringify(input).length > 8192) { fatal(); return; }
    void (async () => {
      try {
        const value = await execute(message.data.command);
        await send({ kind: "reply", id: message.data.id, ok: true, value });
        if (message.data.command.kind === "shutdown") { globalThis.fetch = originalFetch; process.removeListener("uncaughtException", fatal); process.removeListener("unhandledRejection", fatal); process.disconnect?.(); }
      } catch { await send({ kind: "reply", id: message.data.id, ok: false }); }
    })();
  });
  await send({ kind: "ready", pid: process.pid });
}
if (process.env.UNFREQ_ABUSE_FIXTURE === "1" && process.send) void main().catch(async () => { try { await send({ kind: "fatal" }); } finally { process.exit(1); } });
