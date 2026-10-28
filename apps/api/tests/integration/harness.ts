import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createProviderStub, type IntegrationProvider } from "./provider-stub.js";
import { verifyIntegrationRuntime } from "../../../../scripts/integration-runtime.mjs";

type ManagedEnvironment = { databaseUrl: string; redisUrl: string; runId: string };
type IntegrationSql = ReturnType<typeof postgres>;
type CoreModules = {
  app: typeof import("../../src/app.js");
  env: typeof import("../../src/config/env.js");
  repository: typeof import("../../src/modules/signals/repository.js");
  publicationRepository: typeof import("../../src/modules/signals/publication-repository.js");
  audioRepository: typeof import("../../src/modules/signals/audio-repository.js");
  generationWorker: typeof import("../../src/modules/signals/generation-worker.js");
  mappers: typeof import("../../src/modules/signals/service-mappers.js");
  audioStorage: typeof import("../../src/modules/signals/audio-storage.js");
};
const coreModulePaths: Record<keyof CoreModules, string> = {
  app: "app.js", env: "config/env.js", repository: "modules/signals/repository.js",
  mappers: "modules/signals/service-mappers.js", audioStorage: "modules/signals/audio-storage.js",
  publicationRepository: "modules/signals/publication-repository.js",
  audioRepository: "modules/signals/audio-repository.js", generationWorker: "modules/signals/generation-worker.js",
};

type CoreSetupPhase =
  | "harness-start" | "db-identity" | "migrate-start" | "migrate-complete"
  | "app-import-start" | "app-import-complete" | "app-build-start" | "app-build-complete"
  | "app-ready-start" | "app-ready-complete" | "harness-ready"
  | "author-register-start" | "author-register-complete" | "reader-register-complete"
  | "admin-register-complete" | "admin-promoted" | "control-create-start"
  | "control-create-complete" | "control-publish-complete";

// Fixed phase names and timing only. This measures cold fixture preparation;
// it never logs a request payload, database URL, cookie or provider output.
export async function recordCoreSetupPhase(phase: CoreSetupPhase): Promise<void> {
  const managed = assertManagedIntegrationEnvironment();
  const directory = fileURLToPath(new URL("../../../../test-results/b1/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, `core-setup-${managed.runId}.jsonl`),
    `${JSON.stringify({ phase, at: Date.now(), pid: process.pid })}\n`);
}

export function assertManagedIntegrationEnvironment(): ManagedEnvironment {
  if (process.env.UNFREQ_INTEGRATION_MANAGED !== "1" || !/^[a-zA-Z0-9_-]{8,96}$/u.test(process.env.UNFREQ_INTEGRATION_RUN_ID ?? "")) {
    throw new Error("Integration tests require the managed isolated runner and a fresh run identifier.");
  }
  let database: URL;
  let redis: URL;
  try {
    database = new URL(process.env.DATABASE_URL ?? "");
    redis = new URL(process.env.REDIS_URL ?? "");
  } catch {
    throw new Error("Integration database and Redis URLs must be explicit loopback test URLs.");
  }
  const isTestPort = (value: string) => Number(value) >= 1024 && Number(value) <= 65535 && ![5432, 6379].includes(Number(value));
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
    database.pathname !== "/unfreq_integration" || database.username !== "unfreq_test" ||
    database.password !== "unfreq_integration_only" || !isTestPort(database.port) || database.search !== "" || database.hash !== "" ||
    redis.protocol !== "redis:" || redis.hostname !== "127.0.0.1" || !isTestPort(redis.port) ||
    redis.username !== "" || redis.password !== "" || !["", "/", "/0"].includes(redis.pathname) || redis.search !== "" || redis.hash !== "" ||
    database.port === redis.port
  ) {
    throw new Error("Integration URLs must target the runner's synthetic database and Redis on distinct non-default loopback ports.");
  }
  return { databaseUrl: database.toString(), redisUrl: redis.toString(), runId: process.env.UNFREQ_INTEGRATION_RUN_ID! };
}

export async function configureIsolatedEnvironment(input: ManagedEnvironment & {
  providerOrigin?: string;
  generationWorkerEnabled?: boolean;
}) {
  const directory = await mkdtemp(join(tmpdir(), "unfreq-integration-"));
  const dotenvPath = join(directory, "empty.env");
  await writeFile(dotenvPath, "# Deliberately empty integration environment.\n", "utf8");
  const overrides: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (/^(AI_|EMBEDDING_|RERANKER_|TTS_|PROVIDER_|SIGNAL_GENERATION_)/u.test(key)) overrides[key] = "";
  }
  Object.assign(overrides, {
    NODE_ENV: "test", DATABASE_URL: input.databaseUrl, REDIS_URL: input.redisUrl,
    DOTENV_CONFIG_PATH: dotenvPath, DOTENV_CONFIG_QUIET: "true", DOTENV_CONFIG_OVERRIDE: "false",
    AI_API_KEY: "integration-stub-only", AI_BASE_URL: input.providerOrigin === undefined ? "" : `${input.providerOrigin}/v1`,
    AI_PROVIDER: "integration-loopback", AI_MODEL: "synthetic-signal-v1",
    AI_FAST_API_KEY: "", AI_FAST_BASE_URL: "", AI_FAST_MODEL: "", AI_FAST_PROVIDER: "",
    EMBEDDING_API_KEY: "", EMBEDDING_BASE_URL: "", EMBEDDING_DIMENSIONS: "1024", EMBEDDING_MODEL: "integration-disabled", EMBEDDING_PROVIDER: "disabled", EMBEDDING_VERSION: "integration-v1",
    RERANKER_API_KEY: "", RERANKER_BASE_URL: "", RERANKER_MODEL: "integration-disabled", RERANKER_PROVIDER: "disabled",
    TTS_API_KEY: "", TTS_BASE_URL: "", TTS_MODEL: "integration-disabled", TTS_PROVIDER: "disabled",
    TTS_STORAGE_DIR: join(directory, "audio"), TTS_VOICE_LEFT: "integration", TTS_VOICE_RIGHT: "integration",
    IMAGE_STORAGE_DIR: join(directory, "images"), HEALTH_DEPENDENCY_TIMEOUT_MS: "500", DB_POOL_MAX: "4",
    SESSION_SECRET: `integration-session-${randomUUID()}`, PROVIDER_CONFIG_SECRET: `integration-provider-${randomUUID()}`,
    AUTH_LOGIN_CODE_RESPONSE: "disabled", AUTH_LOGIN_DELIVERY_MODE: "local-log",
    AUTH_LOGIN_CHALLENGE_TTL_SECONDS: "600", AUTH_LOGIN_MAX_VERIFY_ATTEMPTS: "5", AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS: "1",
    IMAGE_MAX_BYTES: "2097152", WEB_ORIGIN: "http://127.0.0.1:3200", API_HOST: "127.0.0.1", API_PORT: "4000", LOG_LEVEL: "error",
    // Fault-driver fixtures keep the scanner off; normal API integration opts
    // into the same production worker with wholly synthetic timing/capacity.
    SIGNAL_GENERATION_WORKER_ENABLED: input.generationWorkerEnabled === true ? "true" : "false",
    SIGNAL_GENERATION_CONCURRENCY: "2", SIGNAL_GENERATION_SCAN_INTERVAL_MS: "50",
    SIGNAL_GENERATION_LEASE_MS: "2000", SIGNAL_GENERATION_HEARTBEAT_MS: "200",
    SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS: "10000", SIGNAL_GENERATION_MAX_ATTEMPTS: "3",
    SIGNAL_GENERATION_RETRY_BASE_MS: "50", SIGNAL_GENERATION_RETRY_MAX_MS: "500",
    SIGNAL_GENERATION_SHUTDOWN_GRACE_MS: "200",
    SIGNAL_GENERATION_DB_STATEMENT_TIMEOUT_MS: "5000", SIGNAL_GENERATION_DB_LOCK_TIMEOUT_MS: "1000",
  });
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  return async () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const ownedDirectory = resolve(directory);
    if (dirname(ownedDirectory) !== resolve(tmpdir()) || !basename(ownedDirectory).startsWith("unfreq-integration-")) {
      throw new Error("Refusing to remove an unowned integration temporary directory.");
    }
    await rm(ownedDirectory, { recursive: true, force: true });
  };
}

export function installFetchBoundary(provider?: IntegrationProvider) {
  const original = globalThis.fetch;
  const blockedRequests = provider?.blockedRequests ?? [];
  globalThis.fetch = (async (input, init) => {
    let url: URL;
    try {
      url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    } catch {
      blockedRequests.push("invalid-url");
      throw new Error("Integration outbound HTTP blocked.");
    }
    if (provider === undefined || url.origin !== provider.origin) {
      blockedRequests.push(url.origin);
      throw new Error("Integration outbound HTTP blocked.");
    }
    return original(input, { ...init, redirect: "error" });
  }) as typeof fetch;
  return Object.assign(() => { globalThis.fetch = original; }, { blockedRequests });
}

export type IntegrationHarness = {
  app: FastifyInstance;
  sql: IntegrationSql;
  provider: IntegrationProvider;
  readonly generationActiveCount: number;
  loadModule: <K extends keyof CoreModules>(name: K) => Promise<CoreModules[K]>;
  takeLocalLoginCode: () => string | undefined;
  close: () => Promise<void>;
};

export async function createIntegrationHarness(): Promise<IntegrationHarness> {
  const managed = assertManagedIntegrationEnvironment();
  await recordCoreSetupPhase("harness-start");
  const provider = await createProviderStub();
  const restoreEnvironment = await configureIsolatedEnvironment({
    ...managed, providerOrigin: provider.origin, generationWorkerEnabled: true,
  });
  const restoreFetch = installFetchBoundary(provider);
  const sql = postgres(managed.databaseUrl, {
    max: 1, prepare: false, connect_timeout: 2,
    connection: { application_name: `unfreq-integration-harness-${managed.runId}` },
  });
  let app: FastifyInstance | undefined;
  let generationWorker: ReturnType<CoreModules["generationWorker"]["createSignalGenerationWorker"]> | undefined;
  let lastLocalLoginCode: string | undefined;
  async function loadModule<K extends keyof CoreModules>(name: K): Promise<CoreModules[K]> {
    if (!Object.hasOwn(coreModulePaths, name)) throw new Error("Unrecognized core integration module.");
    const runtime = await verifyIntegrationRuntime({
      repositoryRoot: fileURLToPath(new URL("../../../../", import.meta.url)), runId: managed.runId,
      runtimeDirectory: process.env.UNFREQ_INTEGRATION_RUNTIME_DIR ?? "",
      ownershipToken: process.env.UNFREQ_INTEGRATION_RUNTIME_TOKEN ?? "",
    });
    const namespace: unknown = await import(/* @vite-ignore */
      pathToFileURL(join(runtime.runtimeDirectory, "apps/api/src", coreModulePaths[name])).href);
    if (typeof namespace !== "object" || namespace === null) throw new Error("Owned core integration module is unavailable.");
    return namespace as CoreModules[K];
  }
  const generationIds = new Set<string>();
  try {
    const identity = await sql<{ database: string; username: string }[]>`select current_database() as database, current_user as username`;
    await recordCoreSetupPhase("db-identity");
    if (identity[0]?.database !== "unfreq_integration" || identity[0]?.username !== "unfreq_test") throw new Error("Managed database identity did not match the integration runner.");
    const tables = await sql`select table_name from information_schema.tables where table_schema in ('public', 'drizzle')`;
    if (tables.length !== 0) throw new Error("Integration runner must provide a new empty database; refusing to migrate existing tables.");
    await recordCoreSetupPhase("migrate-start");
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    await recordCoreSetupPhase("migrate-complete");
    await sql`create table unfreq_integration_run (run_id text primary key)`;
    await sql`insert into unfreq_integration_run (run_id) values (${managed.runId})`;
    const configs = await sql`select id from provider_configs`;
    if (configs.length !== 0) throw new Error("Integration provider configuration must begin empty.");
    await recordCoreSetupPhase("app-import-start");
    // Reuse this run's fresh, hashed compilation. Core flow still exercises
    // real Fastify/SQL/Redis; cold TypeScript loader work is fixture overhead.
    const appModule = await loadModule("app");
    if (typeof appModule.buildApp !== "function") {
      throw new Error("Owned integration app export is unavailable.");
    }
    const { buildApp } = appModule;
    const { createSignalGenerationWorker } = await loadModule("generationWorker");
    await recordCoreSetupPhase("app-import-complete");
    await recordCoreSetupPhase("app-build-start");
    app = await buildApp({
      generationWorkerFactory(options) {
        if (generationWorker !== undefined) throw new Error("Core generation worker was already captured.");
        // Observe the original compiled worker; all options and work remain real.
        generationWorker = createSignalGenerationWorker(options);
        return generationWorker;
      },
      logger: { level: "info", stream: { write(line: string) {
      // Observe only this synthetic local delivery channel in bounded memory.
      // Do not replace randomness/services or emit codes to stdout/files/HTTP.
      try {
        const entry = JSON.parse(line) as { action?: unknown; loginChallengeCode?: unknown };
        if (entry.action === "auth.login.challenge.request" && typeof entry.loginChallengeCode === "string" && /^\d{6}$/u.test(entry.loginChallengeCode)) {
          lastLocalLoginCode = entry.loginChallengeCode;
        }
      } catch { /* Non-delivery log lines are deliberately discarded. */ }
    } } } });
    await recordCoreSetupPhase("app-build-complete");
    app.addHook("onSend", async (request, reply, payload) => {
      if (request.method === "POST" && /^\/api\/signals\/?$/u.test(request.url) && reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === "string") {
        const body = JSON.parse(payload) as { data?: { signal?: { id?: unknown } } };
        if (typeof body.data?.signal?.id === "string") generationIds.add(body.data.signal.id);
      }
      return payload;
    });
    await recordCoreSetupPhase("app-ready-start");
    await app.ready();
    await recordCoreSetupPhase("app-ready-complete");
  } catch (error) {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 1 });
    await provider.close();
    restoreFetch();
    await restoreEnvironment();
    throw error;
  }
  const readyApp = app;
  await recordCoreSetupPhase("harness-ready");
  let closed = false;
  return {
    app: readyApp,
    sql,
    provider,
    get generationActiveCount() {
      if (generationWorker === undefined) throw new Error("Core generation worker has not been captured.");
      return generationWorker.activeCount;
    },
    loadModule,
    takeLocalLoginCode() { const code = lastLocalLoginCode; lastLocalLoginCode = undefined; return code; },
    async close() {
      if (closed) return;
      closed = true;
      lastLocalLoginCode = undefined;
      provider.releaseAll();
      let drainError: Error | undefined;
      try {
        const deadline = Date.now() + 12_000;
        let stable = 0;
        while (Date.now() < deadline && stable < 3) {
          const pending = generationIds.size === 0 ? [] : await sql`
            select id from signals where id in ${sql([...generationIds])}
            and (generation_status not in ('COMPLETED', 'FAILED') or (generation_status = 'COMPLETED' and galaxy_position is null))
          `;
          const active = await sql<{ count: number }[]>`
            select count(*)::integer as count from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid() and state = 'active'
          `;
          stable = pending.length === 0 && provider.inFlight === 0 && active[0]?.count === 0 ? stable + 1 : 0;
          if (stable < 3) await new Promise((resolve) => setTimeout(resolve, 75));
        }
        if (stable < 3) drainError = new Error("Synthetic background generation did not drain before integration teardown.");
        const fallbackReviews = await sql<{ count: number }[]>`select count(*)::integer as count from ai_reviews where status = 'FALLBACK'`;
        if (fallbackReviews[0]?.count !== 0) drainError = new Error("Synthetic provider output unexpectedly used the fallback path.");
      } catch (error) {
        drainError = error instanceof Error ? error : new Error("Synthetic integration drain failed.");
      }
      try {
        await readyApp.close();
      } finally {
        await sql.end({ timeout: 1 });
        await provider.close();
        restoreFetch();
        await restoreEnvironment();
      }
      if (drainError !== undefined) throw drainError;
      if (provider.blockedRequests.length > 0) throw new Error("Integration attempted HTTP outside the local provider boundary.");
      if (provider.tasks.includes("unsupported")) throw new Error("Integration requested an unsupported synthetic provider task.");
    },
  };
}
