import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createProviderStub, type IntegrationProvider } from "./provider-stub.js";

type ManagedEnvironment = { databaseUrl: string; redisUrl: string; runId: string };
type IntegrationSql = ReturnType<typeof postgres>;

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

export async function configureIsolatedEnvironment(input: ManagedEnvironment & { providerOrigin?: string }) {
  const directory = await mkdtemp(join(tmpdir(), "unfreq-integration-"));
  const dotenvPath = join(directory, "empty.env");
  await writeFile(dotenvPath, "# Deliberately empty integration environment.\n", "utf8");
  const overrides: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (/^(AI_|EMBEDDING_|RERANKER_|TTS_|PROVIDER_)/u.test(key)) overrides[key] = "";
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
  close: () => Promise<void>;
};

export async function createIntegrationHarness(): Promise<IntegrationHarness> {
  const managed = assertManagedIntegrationEnvironment();
  const provider = await createProviderStub();
  const restoreEnvironment = await configureIsolatedEnvironment({ ...managed, providerOrigin: provider.origin });
  const restoreFetch = installFetchBoundary(provider);
  const sql = postgres(managed.databaseUrl, {
    max: 1, prepare: false, connect_timeout: 2,
    connection: { application_name: `unfreq-integration-harness-${managed.runId}` },
  });
  let app: FastifyInstance | undefined;
  const generationIds = new Set<string>();
  try {
    const identity = await sql<{ database: string; username: string }[]>`select current_database() as database, current_user as username`;
    if (identity[0]?.database !== "unfreq_integration" || identity[0]?.username !== "unfreq_test") throw new Error("Managed database identity did not match the integration runner.");
    const tables = await sql`select table_name from information_schema.tables where table_schema in ('public', 'drizzle')`;
    if (tables.length !== 0) throw new Error("Integration runner must provide a new empty database; refusing to migrate existing tables.");
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)) });
    await sql`create table unfreq_integration_run (run_id text primary key)`;
    await sql`insert into unfreq_integration_run (run_id) values (${managed.runId})`;
    const configs = await sql`select id from provider_configs`;
    if (configs.length !== 0) throw new Error("Integration provider configuration must begin empty.");
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ logger: false });
    app.addHook("onSend", async (request, reply, payload) => {
      if (request.method === "POST" && /^\/api\/signals\/?$/u.test(request.url) && reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === "string") {
        const body = JSON.parse(payload) as { data?: { signal?: { id?: unknown } } };
        if (typeof body.data?.signal?.id === "string") generationIds.add(body.data.signal.id);
      }
      return payload;
    });
    await app.ready();
  } catch (error) {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 1 });
    await provider.close();
    restoreFetch();
    await restoreEnvironment();
    throw error;
  }
  const readyApp = app;
  let closed = false;
  return {
    app: readyApp,
    sql,
    provider,
    async close() {
      if (closed) return;
      closed = true;
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
