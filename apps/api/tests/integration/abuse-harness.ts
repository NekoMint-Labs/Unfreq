import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer, connect, type Socket } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { WebSocketServer, WebSocket } from "ws";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";
import { assertManagedIntegrationEnvironment } from "./harness.js";
import { abuseEmptyEnvironment, syntheticAbusePolicy, type AbuseCase, type AbuseCommand, type AbuseMessage, type AbuseResponse } from "./abuse-process-fixture.js";
import { fixtureMaterial, fixtureFingerprint, fixtureExpansion, fixtureReview } from "./fixtures.js";
import { getChatProviderPrompt } from "../../src/modules/ai/provider-prompts.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
type Kind = "chat" | "embedding" | "reranker" | "tts";
type Diagnostics = { blocked: number; unhandled: number; logOverflow: boolean; logLeaks: boolean; diagnosticEvents: number };

export class AbuseProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  readonly infrastructureErrors: string[] = [];
  readonly bootEvents: { phase: string; at: number; elapsedMs: number }[] = [];
  private spawnedAt = Date.now();
  private ended = false;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private stopping: Promise<void> | undefined;
  private lastBootPhase = "before-validation";
  private bootFailure: Error | undefined;
  constructor(entry: string, environment: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [entry], { cwd: root, env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    this.pid = this.child.pid ?? -1;
    let accept!: () => void; let reject!: (error: Error) => void; let close!: () => void;
    this.ready = new Promise<void>((yes, no) => { accept = yes; reject = no; }); void this.ready.catch(() => {});
    this.closed = new Promise<void>((yes) => { close = yes; });
    this.child.once("error", () => { this.infrastructureErrors.push("SPAWN_FAILED"); reject(new Error("Owned B3 process could not start.")); });
    let bytes = 0;
    const output = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65_536) { this.infrastructureErrors.push("OUTPUT_LIMIT"); void this.kill().catch(() => {}); } };
    this.child.stdout?.on("data", output); this.child.stderr?.on("data", output);
    this.child.once("close", (code, signal) => {
      this.ended = true; close();
      reject(this.bootFailure ?? new Error(`Owned B3 process closed before ready at ${this.lastBootPhase} (code ${code ?? "none"}, signal ${signal ?? "none"}).`));
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("Owned B3 process closed during command.")); }
      this.pending.clear();
    });
    this.child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object" || !("kind" in raw)) return;
      const message = raw as AbuseMessage;
      if (message.kind === "boot") {
        if (message.pid !== this.pid || !["validation-start", "validation-complete", "db-guard-start", "db-guard-complete", "app-import-start", "app-import-complete", "app-build-start", "app-build-complete", "app-ready-start"].includes(message.phase) || !Number.isSafeInteger(message.at)) {
          this.infrastructureErrors.push("INVALID_BOOT_EVENT"); void this.kill().catch(() => {});
        } else { this.lastBootPhase = message.phase; this.bootEvents.push({ phase: message.phase, at: message.at, elapsedMs: Date.now() - this.spawnedAt }); }
      }
      if (message.kind === "ready") { if (message.pid === this.pid) { this.bootEvents.push({ phase: "ready", at: Date.now(), elapsedMs: Date.now() - this.spawnedAt }); accept(); } else { this.infrastructureErrors.push("PID_MISMATCH"); void this.kill().catch(() => {}); } }
      if (message.kind === "fatal") { this.infrastructureErrors.push("FIXTURE_FATAL"); reject(new Error("Owned B3 fixture failed.")); void this.kill().catch(() => {}); }
      if (message.kind === "reply") {
        const item = this.pending.get(message.id); if (!item) return;
        clearTimeout(item.timer); this.pending.delete(message.id);
        if (message.ok) item.resolve(message.value); else item.reject(new Error("Owned B3 command failed."));
      }
    });
  }
  get isClosed() { return this.ended; }
  async waitReady() {
    let timer: NodeJS.Timeout | undefined;
    try { await Promise.race([this.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => {
      this.infrastructureErrors.push("READY_TIMEOUT");
      this.bootFailure = new Error(`B3 cold boot exceeded 20s at ${this.lastBootPhase} after terminating its PID.`);
      void this.kill().then(() => reject(this.bootFailure), reject);
    }, 20_000); })]); }
    catch (error) { await this.kill(); throw error; }
    finally { if (timer) clearTimeout(timer); }
  }
  request<T = unknown>(command: AbuseCommand, budget = 5_000): Promise<T> {
    if (this.ended || !this.child.connected) return Promise.reject(new Error("Owned B3 IPC is closed."));
    const id = ++this.sequence;
    return new Promise<T>((yes, no) => {
      const timer = setTimeout(() => { this.infrastructureErrors.push("COMMAND_TIMEOUT"); void this.kill().then(() => no(new Error("B3 command exceeded budget after terminating its PID.")), no); }, budget);
      this.pending.set(id, { resolve: (value) => yes(value as T), reject: no, timer });
      this.child.send({ id, command }, (error) => { if (error) void this.kill().then(() => no(new Error("Owned B3 IPC send failed.")), no); });
    });
  }
  async kill() {
    if (this.ended) return;
    this.stopping ??= (async () => {
      this.child.kill("SIGKILL"); let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Owned B3 PID did not exit after SIGKILL.")), 3_000); })]); }
      finally { if (timer) clearTimeout(timer); }
    })();
    await this.stopping;
  }
  async stop() {
    if (this.ended) return;
    const result = await this.request<Diagnostics>({ kind: "shutdown" }, 15_000);
    let timer: NodeJS.Timeout | undefined;
    try { await Promise.race([this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Owned B3 PID retained resources after close.")), 3_000); })]); }
    catch (error) { await this.kill(); throw error; }
    finally { if (timer) clearTimeout(timer); }
    if (result.blocked || result.unhandled || result.logLeaks || result.logOverflow || this.child.exitCode !== 0) throw new Error("Owned B3 diagnostics or natural close failed.");
  }
}

async function providerStub() {
  const counts: Record<Kind, number> = { chat: 0, embedding: 0, reranker: 0, tts: 0 };
  const failures: Record<Kind, number> = { chat: 0, embedding: 0, reranker: 0, tts: 0 };
  const held = new Set<() => void>(); const sockets = new Set<Socket>();
  let holdChat = false; let holdTts = false; let activeWs = 0; let peakWs = 0; let blocked = 0;
  const server = httpServer((request, response) => { void (async () => {
    const kind: Kind | undefined = request.url === "/v1/chat/completions" ? "chat" : request.url === "/v1/embeddings" ? "embedding" : request.url === "/v1/rerank" ? "reranker" : undefined;
    if (!kind || request.method !== "POST" || request.headers.authorization !== "Bearer abuse-stub-only") { blocked += 1; response.writeHead(403).end(); return; }
    let raw = "";
    try {
      for await (const part of request) { raw += part; if (raw.length > 128_000) throw new Error("Synthetic body limit."); }
      const body = JSON.parse(raw) as { messages?: Array<{ role: string; content: string }> };
      counts[kind] += 1;
      if (failures[kind]-- > 0) { response.writeHead(500).end(); return; }
      if (kind === "chat" && holdChat) await new Promise<void>((done) => { const release = () => { held.delete(release); done(); }; held.add(release); });
      let result: unknown;
      if (kind === "embedding") result = { data: [{ embedding: [1, ...Array<number>(1023).fill(0)] }] };
      if (kind === "reranker") result = { results: [{ id: "00000000-0000-4000-8000-000000000101", score: 0.9, reason: "synthetic" }] };
      if (kind === "chat") {
        const prompt = body.messages?.find((item) => item.role === "system")?.content;
        const outputs = [["signal-material", fixtureMaterial], ["signal-fingerprint", fixtureFingerprint], ["signal-expansion", fixtureExpansion], ["signal-expansion-review", fixtureReview]] as const;
        const entry = outputs.find(([task]) => getChatProviderPrompt(task) === prompt);
        if (!entry) { blocked += 1; response.writeHead(400).end(); return; }
        result = { choices: [{ message: { content: JSON.stringify(entry[1]), role: "assistant" } }] };
      }
      if (!response.destroyed) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch { if (!response.destroyed) response.writeHead(400).end(); }
  })(); });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/tts" || request.headers.authorization !== "Bearer abuse-stub-only") { blocked += 1; socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws) => {
    counts.tts += 1; activeWs += 1; peakWs = Math.max(peakWs, activeWs);
    ws.once("close", () => { activeWs -= 1; });
    ws.on("message", (raw) => {
      let message: { header?: { action?: string } };
      try { message = JSON.parse(raw.toString()) as typeof message; }
      catch { blocked += 1; ws.terminate(); return; }
      if (message.header?.action === "run-task") ws.send(JSON.stringify({ header: { event: "task-started" } }));
      if (message.header?.action === "finish-task") {
        const finish = () => {
          held.delete(finish); if (ws.readyState !== WebSocket.OPEN) return;
          if (failures.tts-- > 0) ws.send(JSON.stringify({ header: { event: "task-failed" } }));
          else { ws.send(Buffer.from("synthetic-mp3")); ws.send(JSON.stringify({ header: { event: "task-finished" } })); }
        };
        if (holdTts) held.add(finish); else finish();
      }
    });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned B3 provider address failed.");
  return { origin: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/tts`, counts,
    get activeWs() { return activeWs; }, get peakWs() { return peakWs; }, get blocked() { return blocked; },
    failNext(kind: Kind, count = 1) { failures[kind] = count; }, holdChat() { holdChat = true; }, holdTts() { holdTts = true; },
    release() { holdChat = false; holdTts = false; for (const release of [...held]) release(); },
    async close() {
      for (const release of [...held]) release(); for (const client of wss.clients) client.terminate(); for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise<void>((done) => wss.close(() => done())), new Promise<void>((done) => server.close(() => done()))]);
      if (activeWs !== 0 || sockets.size !== 0 || blocked) throw new Error("Owned B3 provider boundary or cleanup failed.");
    } };
}

async function redisGate(upstream: URL) {
  const sockets = new Set<Socket>(); const keys = new Set<string>(); let closed = false;
  const server = tcpServer((incoming) => {
    const outgoing = connect({ host: "127.0.0.1", port: Number(upstream.port) });
    for (const socket of [incoming, outgoing]) { sockets.add(socket); socket.on("error", () => { incoming.destroy(); outgoing.destroy(); }); socket.once("close", () => sockets.delete(socket)); }
    let buffered = Buffer.alloc(0);
    incoming.on("data", (part: Buffer) => {
      buffered = Buffer.concat([buffered, part]);
      if (buffered.length > 262_144) { incoming.destroy(); outgoing.destroy(); return; }
      while (buffered.length) {
        let offset = buffered.indexOf("\r\n"); if (offset < 0) return;
        const count = Number(buffered.subarray(1, offset).toString()); offset += 2;
        if (buffered[0] !== 42 || !Number.isSafeInteger(count) || count < 1 || count > 256) { incoming.destroy(); outgoing.destroy(); return; }
        const args: string[] = []; let incomplete = false;
        for (let index = 0; index < count; index++) {
          const end = buffered.indexOf("\r\n", offset); if (end < 0) { incomplete = true; break; }
          const length = Number(buffered.subarray(offset + 1, end).toString());
          if (buffered[offset] !== 36 || !Number.isSafeInteger(length) || length < 0 || length > 131_072) { incoming.destroy(); outgoing.destroy(); return; }
          if (end + 2 + length + 2 > buffered.length) { incomplete = true; break; }
          args.push(buffered.subarray(end + 2, end + 2 + length).toString()); offset = end + 2 + length + 2;
        }
        if (incomplete) return;
        const command = args[0].toUpperCase();
        const touched = command === "EVAL" ? args.slice(3, 3 + Number(args[2])) : ["SET", "GET", "DEL", "TTL", "PTTL"].includes(command) ? args.slice(1, 2) : [];
        for (const key of touched) if (/^(?:unfreq:abuse:v1:[a-f0-9]{64}|auth:login:(?:challenge|request-cooldown):[A-Za-z0-9_-]{43})$/u.test(key)) keys.add(key);
        buffered = buffered.subarray(offset);
      }
    });
    incoming.pipe(outgoing); outgoing.pipe(incoming);
    incoming.once("close", () => outgoing.destroy()); outgoing.once("close", () => incoming.destroy());
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned B3 Redis proxy address failed.");
  return { url: `redis://127.0.0.1:${address.port}/0`, keys, port: address.port, get socketCount() { return sockets.size; },
    async close() {
      if (closed) return; closed = true;
      const exits = [...sockets].map((socket) => new Promise<void>((done) => {
        if (socket.closed) { done(); return; }
        socket.once("close", () => done()); socket.destroy();
      }));
      await Promise.all([new Promise<void>((done) => server.close(() => done())), ...exits]);
      if (sockets.size) throw new Error("Owned B3 Redis proxy retained sockets.");
    } };
}

export async function createAbuseHarness(caseId: AbuseCase) {
  const managed = assertManagedIntegrationEnvironment();
  const runtime = await verifyIntegrationRuntime({ entry: "abuse", repositoryRoot: root, runId: managed.runId,
    runtimeDirectory: process.env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "", ownershipToken: process.env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "" });
  const nonce = randomUUID().replaceAll("-", "").slice(0, 24);
  const databaseName = `unfreq_integration_b3_${createHash("sha256").update(managed.runId).digest("hex").slice(0, 10)}_${nonce.slice(0, 12)}`;
  const directory = await mkdtemp(join(tmpdir(), `unfreq-abuse-${nonce}-`));
  const children: AbuseProcess[] = [];
  let admin: ReturnType<typeof postgres> | undefined; let sql: ReturnType<typeof postgres> | undefined;
  let provider: Awaited<ReturnType<typeof providerStub>> | undefined; let proxy: Awaited<ReturnType<typeof redisGate>> | undefined;
  let redis: Redis | undefined; let created = false; let marked = false; let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= (async () => {
    const errors: unknown[] = [];
    const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { errors.push(error); } };
    for (const child of children) {
      await attempt(() => child.stop()); await attempt(() => child.kill());
      if (child.infrastructureErrors.length) errors.push(new Error(`B3 fixture infrastructure: ${child.infrastructureErrors.join(",")}`));
    }
    if (provider) await attempt(() => provider!.close());
    if (proxy) await attempt(() => proxy!.close());
    if (redis && proxy) await attempt(async () => { if (proxy!.keys.size) await redis!.del(...proxy!.keys); });
    redis?.disconnect();
    let mayDrop = false;
    if (created && admin) await attempt(async () => {
      const [owner] = await admin!`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${databaseName}`;
      if (owner?.owner !== "unfreq_test") throw new Error("Refusing B3 drop: owner mismatch.");
      if (marked) {
        if (!sql) throw new Error("Refusing B3 drop without observer.");
        const rows = await sql`select run_id, nonce, case_id from abuse_test_ownership`;
        if (rows.length !== 1 || rows[0].run_id !== managed.runId || rows[0].nonce !== nonce || rows[0].case_id !== caseId) throw new Error("Refusing B3 drop: marker mismatch.");
      }
      mayDrop = true;
    });
    if (sql) await attempt(() => sql!.end({ timeout: 0 }));
    if (mayDrop && admin) await attempt(async () => {
      const deadline = Date.now() + 3_000;
      while ((await admin!`select pid from pg_stat_activity where datname = ${databaseName}`).length) {
        if (Date.now() > deadline) throw new Error("Refusing B3 drop with active sessions."); await sleep(20);
      }
      await admin!`drop database ${admin!(databaseName)}`;
      if ((await admin!`select datname from pg_database where datname = ${databaseName}`).length) throw new Error("B3 DB remained after drop.");
    });
    if (admin) await attempt(() => admin!.end({ timeout: 0 }));
    await attempt(async () => {
      if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith(`unfreq-abuse-${nonce}-`)) throw new Error("Refusing unowned B3 media removal.");
      await rm(directory, { recursive: true, force: true });
    });
    await mkdir(join(root, "test-results", "b3"), { recursive: true });
    await writeFile(join(root, "test-results", "b3", `boot-${managed.runId}-${caseId}-${nonce.slice(0, 8)}.json`),
      JSON.stringify({ runId: managed.runId, caseId, cleanupErrors: errors.length,
        children: children.map((child) => ({ pid: child.pid, bootEvents: child.bootEvents, infrastructureErrors: child.infrastructureErrors })) }, null, 2));
    if (errors.length) throw new AggregateError(errors, "B3 experiment cleanup or fixture boundary failed.");
  })();
  try {
    await writeFile(join(directory, "empty.env"), abuseEmptyEnvironment);
    admin = postgres(managed.databaseUrl, { max: 1, prepare: false, connect_timeout: 5, connection: { statement_timeout: 2500 } });
    const [identity] = await admin`select current_database() as name, current_user as owner`;
    if (identity?.name !== "unfreq_integration" || identity.owner !== "unfreq_test" || (await admin`select datname from pg_database where datname = ${databaseName}`).length) throw new Error("B3 runner DB identity mismatch.");
    await admin`create database ${admin(databaseName)}`; created = true;
    const database = new URL(managed.databaseUrl); database.protocol = "postgres:"; database.pathname = `/${databaseName}`;
    sql = postgres(database.toString(), { max: 1, prepare: false, connect_timeout: 5, connection: { statement_timeout: 2500 } });
    if ((await sql`select table_name from information_schema.tables where table_schema in ('public','drizzle')`).length) throw new Error("B3 requires an empty DB.");
    await sql`create table abuse_test_ownership(run_id text not null, case_id text not null, nonce text primary key)`;
    await sql`insert into abuse_test_ownership values (${managed.runId}, ${caseId}, ${nonce})`; marked = true;
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    provider = await providerStub(); proxy = await redisGate(new URL(managed.redisUrl));
    redis = new Redis(managed.redisUrl, { lazyConnect: true, enableOfflineQueue: false, retryStrategy: () => null, maxRetriesPerRequest: 0 }); await redis.connect();
    const environment: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "SYSTEMDRIVE"].includes(key.toUpperCase())));
    Object.assign(environment, { UNFREQ_INTEGRATION_MANAGED: "1", UNFREQ_INTEGRATION_RUN_ID: managed.runId,
      UNFREQ_INTEGRATION_RUNTIME_DIR: runtime.runtimeDirectory, UNFREQ_INTEGRATION_RUNTIME_TOKEN: runtime.ownershipToken,
      UNFREQ_ABUSE_FIXTURE: "1", UNFREQ_ABUSE_PARENT_PID: String(process.pid), UNFREQ_ABUSE_CASE: caseId, UNFREQ_ABUSE_NONCE: nonce,
      UNFREQ_ABUSE_DIRECTORY: directory, UNFREQ_ABUSE_HTTP: provider.origin, UNFREQ_ABUSE_WS: provider.wsUrl,
      DATABASE_URL: database.toString(), REDIS_URL: proxy.url, NODE_ENV: caseId === "production" ? "production" : "test",
      DOTENV_CONFIG_PATH: join(directory, "empty.env"), DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_OVERRIDE: "false",
      ABUSE_PROTECTION_ENABLED: "true", ABUSE_LIMITS_JSON: JSON.stringify(syntheticAbusePolicy(caseId, `b3_${managed.runId}_${nonce}`)),
      ABUSE_HMAC_SECRET: `abuse-budget-${nonce}`, SESSION_SECRET: `abuse-session-${nonce}`, PROVIDER_CONFIG_SECRET: `abuse-provider-${nonce}`,
      TRUSTED_PROXY_CIDRS: caseId === "trusted" ? "127.0.0.1/32" : "",
      AUTH_LOGIN_DELIVERY_MODE: ["disabled", "production"].includes(caseId) ? "disabled" : "local-log", AUTH_LOGIN_CODE_RESPONSE: ["disabled", "production"].includes(caseId) ? "disabled" : "enabled",
      AUTH_LOGIN_CHALLENGE_TTL_SECONDS: "60", AUTH_LOGIN_MAX_VERIFY_ATTEMPTS: "5", AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS: "1",
      AI_API_KEY: "abuse-stub-only", AI_BASE_URL: `${provider.origin}/v1`, AI_PROVIDER: "integration-loopback", AI_MODEL: "synthetic-main",
      AI_FAST_API_KEY: "", AI_FAST_BASE_URL: "", AI_FAST_MODEL: "", AI_FAST_PROVIDER: "",
      EMBEDDING_API_KEY: ["providerembedding", "redisfault"].includes(caseId) ? "abuse-stub-only" : "", EMBEDDING_BASE_URL: ["providerembedding", "redisfault"].includes(caseId) ? `${provider.origin}/v1` : "", EMBEDDING_DIMENSIONS: "1024", EMBEDDING_MODEL: "synthetic-embedding", EMBEDDING_PROVIDER: "integration-loopback", EMBEDDING_VERSION: "b3-synthetic-v1",
      RERANKER_API_KEY: ["providerreranker", "redisfault"].includes(caseId) ? "abuse-stub-only" : "", RERANKER_BASE_URL: ["providerreranker", "redisfault"].includes(caseId) ? `${provider.origin}/v1` : "", RERANKER_PROVIDER: "integration-loopback", RERANKER_MODEL: "synthetic-reranker", RERANKER_SCORE_SCALE: "zero_to_one",
    SIGNAL_MATCH_SEMANTIC_CANDIDATES: "12", SIGNAL_MATCH_RULE_CANDIDATES: "24", SIGNAL_MATCH_MIN_SCORE: "80", SIGNAL_MATCH_MAX_RERANK_CHARACTERS: "12000",
      TTS_API_KEY: "abuse-stub-only", TTS_BASE_URL: provider.wsUrl, TTS_PROVIDER: "integration-loopback", TTS_MODEL: "synthetic-tts", TTS_VOICE_LEFT: "synthetic", TTS_VOICE_RIGHT: "synthetic",
      TTS_STORAGE_DIR: join(directory, "audio"), IMAGE_STORAGE_DIR: join(directory, "images"), IMAGE_MAX_BYTES: "2097152",
      SIGNAL_GENERATION_WORKER_ENABLED: ["generation", "generationfailed", "request", "daily", "audio", "audiostop", "audiofault", "reports"].includes(caseId) ? "true" : "false",
      SIGNAL_GENERATION_CONCURRENCY: "2", SIGNAL_GENERATION_SCAN_INTERVAL_MS: "50", SIGNAL_GENERATION_LEASE_MS: "2000", SIGNAL_GENERATION_HEARTBEAT_MS: "200", SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS: "10000", SIGNAL_GENERATION_MAX_ATTEMPTS: "3",
      SIGNAL_GENERATION_RETRY_BASE_MS: "50", SIGNAL_GENERATION_RETRY_MAX_MS: "500", SIGNAL_GENERATION_SHUTDOWN_GRACE_MS: "200", SIGNAL_GENERATION_DB_STATEMENT_TIMEOUT_MS: "5000", SIGNAL_GENERATION_DB_LOCK_TIMEOUT_MS: "1000",
      WEB_ORIGIN: caseId === "production" ? "https://b3-synthetic.example" : "http://127.0.0.1:3200", API_HOST: "127.0.0.1", API_PORT: "4000", HEALTH_DEPENDENCY_TIMEOUT_MS: "500", DB_POOL_MAX: "4", LOG_LEVEL: "warn" });
    const readySql = sql; const readyRedis = redis; const readyProvider = provider; const readyProxy = proxy;
    return { sql: readySql, redis: readyRedis, provider: readyProvider, proxy: readyProxy, close,
      async start() {
        const checked = await verifyIntegrationRuntime({ repositoryRoot: root, entry: "abuse", runId: managed.runId, runtimeDirectory: runtime.runtimeDirectory, ownershipToken: runtime.ownershipToken });
        const child = new AbuseProcess(checked.entryPath, environment); children.push(child); await child.waitReady(); return child;
      },
      inject(child: AbuseProcess, command: Omit<Extract<AbuseCommand, { kind: "inject" }>, "kind">) { return child.request<AbuseResponse>({ kind: "inject", ...command }); },
      async wait(predicate: () => boolean | Promise<boolean>, label: string, ms = 3_000) {
        const deadline = Date.now() + ms;
        while (!(await predicate())) { if (Date.now() >= deadline) throw new Error(`B3 invariant not reached: ${label}.`); await sleep(20); }
      },
      challengeKey(email: string) { return "auth:login:challenge:" + createHmac("sha256", `abuse-session-${nonce}`).update(`login-email:${email.trim().toLowerCase()}`).digest("base64url"); },
      async budgetUsed(rule: string, identity: string) {
        const key = "unfreq:abuse:v1:" + createHmac("sha256", `abuse-budget-${nonce}`).update(JSON.stringify(["budget", `b3_${managed.runId}_${nonce}`, rule, identity])).digest("hex");
        return Number(await readyRedis.hget(key, "used") ?? "0");
      },
      async leaseCount() {
        const key = "unfreq:abuse:v1:" + createHmac("sha256", `abuse-budget-${nonce}`).update(JSON.stringify(["concurrency", `b3_${managed.runId}_${nonce}`, "scope", "tts"])).digest("hex");
        return readyRedis.zcard(key);
      },
    };
  } catch (error) { try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "B3 setup and cleanup failed."); } throw error; }
}
export type AbuseHarness = Awaited<ReturnType<typeof createAbuseHarness>>;
export async function withAbuseHarness(caseId: AbuseCase, work: (h: AbuseHarness) => Promise<void>) {
  const h = await createAbuseHarness(caseId); let failure: unknown; let failed = false;
  try { await work(h); } catch (error) { failed = true; failure = error; }
  try { await h.close(); } catch (error) { if (failed) throw new AggregateError([failure, error], "B3 case and cleanup failed."); throw error; }
  if (failed) throw failure;
}
