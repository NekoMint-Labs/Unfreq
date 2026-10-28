import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { z } from "zod";
import type { CreateSignalInput } from "../../src/modules/signals/types.js";
import { fixtureExpansion, fixtureFingerprint, fixtureSeed } from "./fixtures.js";

const commandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inject"), method: z.enum(["GET", "POST", "PATCH"]),
    url: z.string().max(160), cookie: z.string().max(2048).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ kind: z.literal("stage"), id: z.string().uuid(), marker: z.enum(["older", "newer"]) }),
  z.object({ kind: z.literal("complete"), marker: z.enum(["older", "newer"]) }),
  z.object({ kind: z.literal("progress"), id: z.string().uuid(), status: z.enum(["EXPANDING", "FAILED"]) }),
  z.object({ kind: z.literal("diagnostics") }),
  z.object({ kind: z.literal("shutdown") }),
]);
const messageSchema = z.object({ id: z.number().int().positive(), command: commandSchema });

export type GenerationCommand = z.infer<typeof commandSchema>;
export type GenerationHttpResponse = { statusCode: number; body: unknown; cookie?: string };
export type GenerationDiagnostics = { blockedHttp: number; unhandled: number };
export type GenerationMessage =
  | { kind: "ready"; pid: number }
  | { kind: "reply"; id: number; ok: true; value: unknown }
  | { kind: "reply"; id: number; ok: false; error: string }
  | { kind: "fatal"; error: string };

const emptyEnvironment = "# Owned generation integration environment; no project dotenv.\n";
export const generationEmptyEnvironment = emptyEnvironment;

async function send(message: GenerationMessage) {
  if (!process.send || !process.connected) throw new Error("Generation fixture lost its owner.");
  await new Promise<void>((resolveSend, reject) => {
    process.send!(message, (error) => error ? reject(error) : resolveSend());
  });
}

async function validateEnvironment() {
  const env = process.env;
  const runId = env.UNFREQ_INTEGRATION_RUN_ID ?? "";
  const caseId = env.UNFREQ_GENERATION_CASE ?? "";
  const nonce = env.UNFREQ_GENERATION_NONCE ?? "";
  if (env.UNFREQ_INTEGRATION_MANAGED !== "1" || env.UNFREQ_GENERATION_FIXTURE !== "1" ||
      !/^[a-zA-Z0-9_-]{8,96}$/u.test(runId) || !/^[a-z]{3,12}$/u.test(caseId) ||
      !/^[a-f0-9]{24}$/u.test(nonce) || Number(env.UNFREQ_GENERATION_PARENT_PID) !== process.ppid) {
    throw new Error("Invalid generation fixture ownership.");
  }
  const digest = createHash("sha256").update(runId).digest("hex").slice(0, 10);
  const databaseName = `unfreq_integration_b1_${digest}_${caseId}_${nonce.slice(0, 8)}`;
  const database = new URL(env.DATABASE_URL ?? "");
  const redis = new URL(env.REDIS_URL ?? "");
  const provider = new URL(env.UNFREQ_GENERATION_PROVIDER_ORIGIN ?? "");
  const testPort = (port: string) => Number(port) >= 1024 && Number(port) <= 65535 && ![5432, 6379].includes(Number(port));
  if (!/^unfreq_integration_b1_[a-f0-9]{10}_[a-z]{3,12}_[a-f0-9]{8}$/u.test(databaseName) || databaseName.length > 63 ||
      database.protocol !== "postgres:" || database.hostname !== "127.0.0.1" || !testPort(database.port) ||
      database.pathname !== `/${databaseName}` || database.username !== "unfreq_test" ||
      database.password !== "unfreq_integration_only" || database.search !== "" || database.hash !== "" ||
      redis.protocol !== "redis:" || redis.hostname !== "127.0.0.1" || !testPort(redis.port) ||
      redis.username !== "" || redis.password !== "" || !["", "/", "/0"].includes(redis.pathname) ||
      redis.search !== "" || redis.hash !== "" || redis.port === database.port ||
      provider.protocol !== "http:" || provider.hostname !== "127.0.0.1" || !testPort(provider.port) ||
      provider.pathname !== "/" || provider.username !== "" || provider.password !== "" || provider.search !== "" || provider.hash !== "" ||
      env.AI_BASE_URL !== `${provider.origin}/v1` || env.AI_API_KEY !== "generation-stub-only" ||
      env.SESSION_SECRET !== `generation-session-${nonce}` || env.PROVIDER_CONFIG_SECRET !== `generation-provider-${nonce}` ||
      env.NODE_ENV !== "test" || env.NODE_OPTIONS !== undefined || env.DOTENV_KEY !== undefined) {
    throw new Error("Invalid generation fixture endpoints or synthetic configuration.");
  }
  for (const key of ["AI_FAST_API_KEY", "AI_FAST_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "RERANKER_API_KEY", "RERANKER_BASE_URL", "TTS_API_KEY", "TTS_BASE_URL"]) {
    if (env[key] !== "") throw new Error("Additional generation provider configuration is forbidden.");
  }
  const directory = resolve(env.UNFREQ_GENERATION_DIRECTORY ?? "");
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(`unfreq-generation-${nonce}-`) ||
      env.DOTENV_CONFIG_PATH !== join(directory, "empty.env") ||
      env.TTS_STORAGE_DIR !== join(directory, "audio") || env.IMAGE_STORAGE_DIR !== join(directory, "images") ||
      await readFile(join(directory, "empty.env"), "utf8") !== emptyEnvironment) {
    throw new Error("Invalid generation fixture temporary directory.");
  }
  return { runId, caseId, nonce, databaseName, databaseUrl: database.toString(), origin: provider.origin };
}

function allowedRequest(command: Extract<GenerationCommand, { kind: "inject" }>) {
  if (command.method === "GET") return command.url === "/health" || /^\/api\/signals\/[a-f0-9-]{36}$/u.test(command.url);
  if (command.method === "POST") return ["/api/auth/register", "/api/signals"].includes(command.url) || /^\/api\/signals\/[a-f0-9-]{36}\/publish$/u.test(command.url);
  return /^\/api\/admin\/signals\/[a-f0-9-]{36}\/status$/u.test(command.url);
}

async function main() {
  const owned = await validateEnvironment();
  const originalFetch = globalThis.fetch;
  let blockedHttp = 0;
  let unhandled = 0;
  globalThis.fetch = (async (input, init) => {
    let url: URL;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); }
    catch { blockedHttp += 1; throw new Error("Generation outbound HTTP blocked."); }
    if (url.origin !== owned.origin) {
      blockedHttp += 1;
      throw new Error("Generation outbound HTTP blocked.");
    }
    return originalFetch(input, { ...init, redirect: "error" });
  }) as typeof fetch;

  // No app/env/db module is imported until both endpoint validation and the
  // HTTP boundary are installed. This client only checks our owned database.
  const guard = postgres(owned.databaseUrl, { max: 1, prepare: false, connect_timeout: 2 });
  try {
    const [identity] = await guard<{ database: string; owner: string }[]>`
      select current_database() as database, current_user as owner
    `;
    const markers = await guard<{ run_id: string; case_id: string; nonce: string }[]>`select run_id, case_id, nonce from generation_test_ownership`;
    const [database] = await guard<{ owner: string }[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()`;
    if (identity?.database !== owned.databaseName || identity.owner !== "unfreq_test" || database?.owner !== "unfreq_test" ||
        markers.length !== 1 || markers[0].run_id !== owned.runId || markers[0].case_id !== owned.caseId || markers[0].nonce !== owned.nonce ||
        (await guard`select id from provider_configs`).length !== 0) {
      throw new Error("Generation database ownership or provider configuration changed.");
    }
  } finally { await guard.end({ timeout: 0 }); }

  const { buildApp } = await import("../../src/app.js");
  const repository = await import("../../src/modules/signals/repository.js");
  const { getFingerprintFrequencyProfile, buildMinimalSignalProgram } = await import("../../src/modules/signals/service-mappers.js");
  const app: FastifyInstance = await buildApp({ logger: false });
  await app.ready();
  const staged = new Map<"older" | "newer", { id: string; input: CreateSignalInput }>();
  let closing = false;

  const fatal = () => {
    unhandled += 1;
    void send({ kind: "fatal", error: "UNHANDLED_GENERATION_FIXTURE_ERROR" }).finally(() => process.exit(1));
  };
  process.on("unhandledRejection", fatal);
  process.on("uncaughtException", fatal);
  process.once("disconnect", () => { if (!closing) process.exit(1); });

  async function ownedSignal(id: string) {
    const signal = await repository.findSignalResultById(id);
    if (!signal || signal.seedText !== fixtureSeed || !signal.authorId || signal.frequencyId !== signal.authorId) {
      throw new Error("Refusing a non-fixture generation target.");
    }
    return signal;
  }

  async function execute(command: GenerationCommand): Promise<unknown> {
    if (closing) throw new Error("Generation fixture is closing.");
    if (command.kind === "diagnostics") return { blockedHttp, unhandled } satisfies GenerationDiagnostics;
    if (command.kind === "inject") {
      if (!allowedRequest(command)) throw new Error("Generation route is not allowed.");
      const response = await app.inject({
        method: command.method, url: command.url,
        headers: command.cookie === undefined ? {} : { cookie: command.cookie },
        ...(command.payload === undefined ? {} : { payload: command.payload }),
      });
      const cookies = response.headers["set-cookie"];
      const cookie = (Array.isArray(cookies) ? cookies : [String(cookies ?? "")])
        .find((value) => value.startsWith("unfreq_session="))?.split(";")[0];
      return { statusCode: response.statusCode, body: response.json<unknown>(), ...(cookie ? { cookie } : {}) } satisfies GenerationHttpResponse;
    }
    if (command.kind === "stage") {
      if (staged.has(command.marker)) throw new Error("Generation writer is already staged.");
      const signal = await ownedSignal(command.id);
      const expandedText = `${fixtureExpansion.expandedText}\n[synthetic-${command.marker}]`;
      staged.set(command.marker, {
        id: signal.id,
        input: {
          authorId: signal.authorId!, frequencyId: signal.frequencyId!,
          expandedText, fingerprint: fixtureFingerprint, rawInput: fixtureSeed, seedText: fixtureSeed,
          frequencyProfile: getFingerprintFrequencyProfile(fixtureFingerprint),
          galaxyPosition: { x: 0, y: 0, z: 0 }, status: "DRAFT",
          program: buildMinimalSignalProgram({ expandedText, fingerprint: fixtureFingerprint, rawInput: fixtureSeed }),
        },
      });
      return { staged: command.marker, id: signal.id };
    }
    if (command.kind === "complete") {
      const writer = staged.get(command.marker);
      if (!writer) throw new Error("Generation writer was not staged.");
      staged.delete(command.marker);
      const row = await repository.completeSignalGeneration(writer);
      return { accepted: row !== undefined };
    }
    if (command.kind === "progress") {
      await ownedSignal(command.id);
      const row = await repository.updateSignalGenerationStatus({
        id: command.id, status: command.status,
        ...(command.status === "FAILED" ? { error: "SYNTHETIC_OLDER_WRITER_FAILED" } : {}),
      });
      return { accepted: row !== undefined };
    }
    closing = true;
    await app.close();
    return { blockedHttp, unhandled } satisfies GenerationDiagnostics;
  }

  process.on("message", (input: unknown) => {
    const parsed = messageSchema.safeParse(input);
    if (!parsed.success || JSON.stringify(input).length > 16_384) {
      void send({ kind: "fatal", error: "INVALID_GENERATION_COMMAND" }).finally(() => process.exit(1));
      return;
    }
    const { id, command } = parsed.data;
    void (async () => {
      try {
        const value = await execute(command);
        await send({ kind: "reply", id, ok: true, value });
        if (command.kind === "shutdown") {
          globalThis.fetch = originalFetch;
          process.removeListener("unhandledRejection", fatal);
          process.removeListener("uncaughtException", fatal);
          process.disconnect?.();
        }
      } catch {
        await send({ kind: "reply", id, ok: false, error: "GENERATION_COMMAND_FAILED" });
      }
    })();
  });
  await send({ kind: "ready", pid: process.pid });
}

// The coordinator imports only this module's types. Executing it requires its
// private IPC channel and the full managed ownership/environment handshake.
if (process.env.UNFREQ_GENERATION_FIXTURE === "1" && process.send) {
  void main().catch(async () => {
    try { await send({ kind: "fatal", error: "GENERATION_BOOT_FAILED" }); }
    finally { process.exit(1); }
  });
}
