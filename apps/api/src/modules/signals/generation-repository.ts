import { and, eq, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../../config/env.js";
import * as schema from "../../db/schema.js";
import { frequencies, signals, users } from "../../db/schema.js";
import { createSignalDraft, signalSelection, toSignalRecord } from "./repository.js";
import type {
  GenerationCasResult, GenerationClaim, GenerationFailureCode, GenerationFence,
  GenerationOutput, GenerationRepositoryOptions, OwnedGenerationInput, RunningGenerationPhase,
} from "./generation-types.js";
import type { CreateSignalInput, SignalRecord } from "./types.js";

// Every consumer of this queue uses this transaction-scoped key. Never hold it
// (or a row lock / transaction) across Provider work.
const queueLockNamespace = 1431193169;
const queueLockId = 1;
const runningPhases = ["EXPANDING", "MATCHING", "WRITING"] as const;
const failureCodes = new Set<GenerationFailureCode>([
  "GENERATION_FAILED", "GENERATION_RETRY_EXHAUSTED", "GENERATION_TIMEOUT",
  "GENERATION_OUTCOME_UNKNOWN", "GENERATION_SUPERSEDED",
]);

export class GenerationInputUnavailableError extends Error {
  constructor() {
    super("Generation input is no longer available.");
    this.name = "GenerationInputUnavailableError";
  }
}

function integerOption(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`Invalid generation repository ${name}.`);
  }
  return value;
}

function validFence(fence: GenerationFence): SQL<boolean> {
  return sql<boolean>`
    ${signals.id} = ${fence.signalId}::uuid
    and ${signals.generationAttemptCount} is not null
    and ${signals.generationAttemptId} = ${fence.attemptId}::uuid
    and ${signals.generationLeaseOwner} = ${fence.ownerId}::uuid
    and ${signals.generationLeaseUntil} > clock_timestamp()
    and ${signals.generationAttemptDeadlineAt} > clock_timestamp()
    and ${signals.status} = 'DRAFT'
    and ${signals.generationStatus} in ('EXPANDING', 'MATCHING', 'WRITING')
  `;
}

function applied<T>(value: T): GenerationCasResult<T> {
  return { outcome: "APPLIED", value };
}

function resultForRows(rows: ReadonlyArray<{ id: string }>): GenerationCasResult {
  return rows.length === 0 ? { outcome: "OBSOLETE" } : applied(undefined);
}

type ClaimRow = {
  signalId: string; attemptId: string; ownerId: string; attemptCount: number;
  leaseUntil: Date | string; deadlineAt: Date | string; remainingMs: number;
};

type ExpiredRow = {
  id: string; attempt_id: string; owner_id: string;
  attempt_count: number; dispatch_started_at: Date | string | null;
};

function claimDate(value: Date | string): Date {
  // Drizzle installs transparent timestamp parsers on this shared Postgres.js
  // client. Raw tagged SQL therefore needs decoding at the repository edge.
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Generation claim returned an invalid timestamp.");
  return date;
}

/** One instance belongs to one app/worker; constructing it opens no connection. */
export function configureSignalGenerationRepository(options: GenerationRepositoryOptions) {
  integerOption(options.statementTimeoutMs, "statement timeout");
  integerOption(options.lockTimeoutMs, "lock timeout");
  integerOption(options.maxConnections ?? 2, "pool size");
  if (options.lockTimeoutMs >= options.statementTimeoutMs) {
    throw new Error("Generation lock timeout must be shorter than statement timeout.");
  }
  const client = postgres(env.databaseUrl, {
    connect_timeout: Math.ceil(env.healthDependencyTimeoutMs / 1000),
    max: options.maxConnections ?? 2,
    prepare: false,
    connection: {
      application_name: "unfreq-generation-worker",
      statement_timeout: options.statementTimeoutMs,
      lock_timeout: options.lockTimeoutMs,
      idle_in_transaction_session_timeout: options.statementTimeoutMs,
    },
  });
  const ownedDb = drizzle(client, { schema });
  let closing = false;
  let closePromise: Promise<void> | undefined;

  function assertOpen() {
    if (closing) throw new Error("Generation repository is closed.");
  }

  async function readSignalRecord(id: string): Promise<SignalRecord> {
    const [row] = await ownedDb.select(signalSelection).from(signals)
      .leftJoin(users, eq(signals.authorId, users.id)).where(eq(signals.id, id)).limit(1);
    if (row === undefined) throw new Error("Completed generation row is unavailable.");
    return toSignalRecord(row);
  }

  return {
    async createManagedPendingSignal(input: CreateSignalInput): Promise<SignalRecord> {
      assertOpen();
      return createSignalDraft({ ...input, managedGeneration: true });
    },

    async claimSignalGenerationBatch(params: {
      ownerId: string; globalCapacity: number; localAvailable: number;
      leaseMs: number; attemptTimeoutMs: number; maxAttempts: number;
    }): Promise<GenerationClaim[]> {
      assertOpen();
      integerOption(params.globalCapacity, "global capacity");
      integerOption(params.localAvailable, "local slots", true);
      integerOption(params.leaseMs, "lease");
      integerOption(params.attemptTimeoutMs, "attempt timeout");
      integerOption(params.maxAttempts, "attempt limit");
      if (params.localAvailable === 0) return [];
      return client.begin("isolation level read committed", async (tx) => {
        const [lock] = await tx<{ acquired: boolean }[]>`
          select pg_try_advisory_xact_lock(${queueLockNamespace}, ${queueLockId}) as acquired`;
        if (!lock?.acquired) return [];
        const [capacity] = await tx<{ active: number }[]>`
          select count(*)::int as active from signals
          where generation_attempt_count is not null and status = 'DRAFT'
            and generation_status in ('EXPANDING', 'MATCHING', 'WRITING')
            and generation_lease_until > clock_timestamp()
            and generation_attempt_deadline_at > clock_timestamp()`;
        const take = Math.max(0, Math.min(params.localAvailable, params.globalCapacity - (capacity?.active ?? 0)));
        if (take === 0) return [];
        const rows = await tx<ClaimRow[]>`
          with tick as materialized (select clock_timestamp() as now), picked as (
            select s.id from signals s cross join tick
            where s.generation_attempt_count is not null
              and s.generation_attempt_count < ${params.maxAttempts}
              and s.status = 'DRAFT' and s.generation_status = 'RECEIVED'
              and s.generation_lease_owner is null and s.generation_lease_until is null
              and s.generation_next_attempt_at <= tick.now
            order by s.generation_next_attempt_at, s.created_at, s.id
            limit ${take} for update of s skip locked
          )
          update signals s set generation_attempt_id = gen_random_uuid(),
            generation_lease_owner = ${params.ownerId}::uuid,
            generation_attempt_count = s.generation_attempt_count + 1,
            generation_attempt_started_at = tick.now,
            generation_attempt_deadline_at = tick.now + ${params.attemptTimeoutMs} * interval '1 millisecond',
            generation_lease_until = tick.now + ${Math.min(params.leaseMs, params.attemptTimeoutMs)} * interval '1 millisecond',
            generation_next_attempt_at = null, generation_dispatch_started_at = null,
            generation_status = 'EXPANDING', generation_error = null, updated_at = tick.now
          from picked, tick where s.id = picked.id
          returning s.id as "signalId", s.generation_attempt_id as "attemptId",
            s.generation_lease_owner as "ownerId", s.generation_attempt_count as "attemptCount",
            s.generation_lease_until as "leaseUntil", s.generation_attempt_deadline_at as "deadlineAt",
            (extract(epoch from (s.generation_attempt_deadline_at - clock_timestamp())) * 1000)::double precision as "remainingMs"`;
        return Array.from(rows, (row) => {
          if (!Number.isFinite(row.remainingMs)) throw new Error("Generation claim returned an invalid remaining deadline.");
          return { ...row, leaseUntil: claimDate(row.leaseUntil), deadlineAt: claimDate(row.deadlineAt) };
        });
      });
    },

    async isSignalGenerationAttemptActive(fence: GenerationFence): Promise<boolean> {
      assertOpen();
      const rows = await ownedDb.select({ id: signals.id }).from(signals).where(validFence(fence)).limit(1);
      return rows.length !== 0;
    },

    async readOwnedSignalGenerationInput(fence: GenerationFence): Promise<GenerationCasResult<OwnedGenerationInput>> {
      assertOpen();
      const [row] = await ownedDb.select({
        id: signals.id, seedText: signals.seedText, parentSignalId: signals.parentSignalId,
        authorId: signals.authorId, frequencyId: signals.frequencyId,
        userId: users.id, createdAt: users.createdAt, freqCode: users.freqCode,
        frequencyName: users.frequencyName, isGuest: users.isGuest, role: users.role, status: users.status,
        mirrorId: frequencies.id, mirrorCode: frequencies.code,
        mirrorGuest: frequencies.isGuest, mirrorStatus: frequencies.status,
      }).from(signals).leftJoin(users, eq(signals.authorId, users.id))
        .leftJoin(frequencies, eq(signals.frequencyId, frequencies.id))
        .where(validFence(fence)).limit(1);
      if (row === undefined) return { outcome: "OBSOLETE" };
      if (row.userId === null || row.userId !== row.authorId || row.userId !== row.frequencyId ||
          row.mirrorId !== row.userId || row.freqCode === null || row.mirrorCode !== row.freqCode ||
          row.createdAt === null || row.role === null || row.status !== "ACTIVE" ||
          row.mirrorStatus !== "ACTIVE" || row.isGuest !== false || row.mirrorGuest !== false) {
        throw new GenerationInputUnavailableError();
      }
      if (row.parentSignalId !== null) {
        const [parent] = await ownedDb.select({ id: signals.id }).from(signals).where(and(
          eq(signals.id, row.parentSignalId), eq(signals.generationStatus, "COMPLETED"),
          sql`${signals.status} <> 'DELETED'`,
          sql`coalesce(${signals.frequencyId}, ${signals.authorId}) = ${row.userId}::uuid`,
        )).limit(1);
        if (parent === undefined) throw new GenerationInputUnavailableError();
      }
      return applied({
        signalId: row.id,
        body: { seedText: row.seedText, ...(row.parentSignalId === null ? {} : { parentSignalId: row.parentSignalId }) },
        frequency: {
          id: row.userId, createdAt: row.createdAt.toISOString(), freqCode: row.freqCode,
          frequencyName: row.frequencyName ?? undefined, isGuest: row.isGuest,
          role: row.role, status: row.status,
        },
      });
    },

    async advanceSignalGenerationPhase(params: {
      fence: GenerationFence; from: RunningGenerationPhase; to: RunningGenerationPhase;
    }): Promise<GenerationCasResult> {
      assertOpen();
      if (!runningPhases.includes(params.from) || !runningPhases.includes(params.to) ||
          (params.from !== params.to && !(
            (params.from === "EXPANDING" && params.to === "MATCHING") ||
            (params.from === "MATCHING" && params.to === "WRITING")
          ))) throw new Error("Invalid generation phase transition.");
      return resultForRows(await ownedDb.update(signals)
        .set({ generationStatus: params.to, updatedAt: sql`clock_timestamp()` })
        .where(and(validFence(params.fence), eq(signals.generationStatus, params.from)))
        .returning({ id: signals.id }));
    },

    async markSignalGenerationDispatch(fence: GenerationFence): Promise<GenerationCasResult> {
      assertOpen();
      return resultForRows(await ownedDb.update(signals).set({
        generationDispatchStartedAt: sql`coalesce(${signals.generationDispatchStartedAt}, clock_timestamp())`,
      }).where(validFence(fence)).returning({ id: signals.id }));
    },

    async renewSignalGenerationLease(params: {
      fence: GenerationFence; leaseMs: number;
    }): Promise<GenerationCasResult<{ leaseUntil: Date }>> {
      assertOpen();
      integerOption(params.leaseMs, "lease");
      const [row] = await ownedDb.update(signals).set({
        generationLeaseUntil: sql`least(${signals.generationAttemptDeadlineAt}, clock_timestamp() + ${params.leaseMs} * interval '1 millisecond')`,
      }).where(validFence(params.fence)).returning({ leaseUntil: signals.generationLeaseUntil });
      if (row === undefined) return { outcome: "OBSOLETE" };
      if (row.leaseUntil === null) throw new Error("Generation lease update returned an invalid tuple.");
      return applied({ leaseUntil: row.leaseUntil });
    },

    async completeOwnedSignalGeneration(params: {
      fence: GenerationFence; output: GenerationOutput;
    }): Promise<GenerationCasResult<SignalRecord>> {
      assertOpen();
      const output = params.output;
      if (output.status !== "DRAFT" && output.status !== "REVIEWING") throw new Error("Invalid generated private status.");
      const [row] = await ownedDb.update(signals).set({
        expandedText: output.expandedText, fingerprintJson: output.fingerprint,
        followUpQuestion: output.followUpQuestion ?? null,
        coreNeed: output.frequencyProfile?.coreNeed ?? null,
        emotionTone: output.frequencyProfile?.emotionTone ?? null,
        innerConflict: output.frequencyProfile?.innerConflict ?? null,
        primaryBand: output.frequencyProfile?.primaryBand ?? null,
        resonanceKeywords: output.frequencyProfile?.resonanceKeywords ?? null,
        subFeeling: output.frequencyProfile?.subFeeling ?? null,
        matchSignalId: output.matchSignalId ?? null, programJson: output.program,
        qualityReason: output.qualityReason ?? null, qualityScore: output.qualityScore ?? null,
        galaxyPosition: output.galaxyPosition,
        ...(output.embedding === undefined ? {} : {
          embedding: output.embedding.embedding, embeddingDimensions: output.embedding.dimensions,
          embeddingModel: output.embedding.model, embeddingProvider: output.embedding.provider,
          embeddingVersion: output.embedding.version,
        }),
        generationStatus: "COMPLETED", generationError: null, status: output.status,
        generationLeaseOwner: null, generationLeaseUntil: null, generationNextAttemptAt: null,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(validFence(params.fence), eq(signals.generationStatus, "WRITING")))
        .returning({ id: signals.id });
      return row === undefined ? { outcome: "OBSOLETE" } : applied(await readSignalRecord(row.id));
    },

    async failOwnedSignalGeneration(params: {
      fence: GenerationFence; code: GenerationFailureCode;
    }): Promise<GenerationCasResult> {
      assertOpen();
      if (!failureCodes.has(params.code)) throw new Error("Invalid safe generation failure code.");
      return resultForRows(await ownedDb.update(signals).set({
        generationStatus: "FAILED", generationError: params.code,
        generationLeaseOwner: null, generationLeaseUntil: null, generationNextAttemptAt: null,
        updatedAt: sql`clock_timestamp()`,
      }).where(validFence(params.fence)).returning({ id: signals.id }));
    },

    async requeueUndispatchedSignalGeneration(params: {
      fence: GenerationFence; maxAttempts: number; backoffMs: number;
    }): Promise<GenerationCasResult> {
      assertOpen();
      integerOption(params.maxAttempts, "attempt limit");
      integerOption(params.backoffMs, "retry backoff", true);
      return resultForRows(await ownedDb.update(signals).set({
        generationStatus: "RECEIVED", generationError: null,
        generationAttemptId: null, generationLeaseOwner: null, generationLeaseUntil: null,
        generationAttemptStartedAt: null, generationAttemptDeadlineAt: null, generationDispatchStartedAt: null,
        generationNextAttemptAt: sql`clock_timestamp() + ${params.backoffMs} * interval '1 millisecond'`,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(validFence(params.fence), sql`${signals.generationDispatchStartedAt} is null`,
        sql`${signals.generationAttemptCount} < ${params.maxAttempts}`)).returning({ id: signals.id }));
    },

    async recoverExpiredSignalGenerations(params: {
      batchSize: number; maxAttempts: number; backoffForAttempt: (n: number) => number;
    }): Promise<{ requeuedIds: string[]; failedIds: string[] }> {
      assertOpen();
      integerOption(params.batchSize, "recovery batch");
      integerOption(params.maxAttempts, "attempt limit");
      return client.begin("isolation level read committed", async (tx) => {
        const result = { requeuedIds: [] as string[], failedIds: [] as string[] };
        const [lock] = await tx<{ acquired: boolean }[]>`
          select pg_try_advisory_xact_lock(${queueLockNamespace}, ${queueLockId}) as acquired`;
        if (!lock?.acquired) return result;
        // A lower retry limit after a controlled restart must not strand an
        // already-queued safe retry forever. No external dispatch is possible
        // in this shape; its empty attempt tuple is valid for FAILED too.
        const exhausted = await tx<{ id: string }[]>`
          with picked as (
            select id from signals where generation_attempt_count is not null
              and generation_attempt_count >= ${params.maxAttempts}
              and generation_status = 'RECEIVED' and status = 'DRAFT'
              and generation_lease_owner is null and generation_lease_until is null
              and generation_next_attempt_at <= clock_timestamp()
            order by generation_next_attempt_at, id limit ${params.batchSize}
            for update skip locked
          )
          update signals s set generation_status = 'FAILED',
            generation_error = 'GENERATION_RETRY_EXHAUSTED', generation_next_attempt_at = null,
            updated_at = clock_timestamp()
          from picked where s.id = picked.id returning s.id`;
        result.failedIds.push(...exhausted.map((row) => row.id));
        const remaining = params.batchSize - exhausted.length;
        if (remaining === 0) return result;
        const rows = await tx<ExpiredRow[]>`
          select id, generation_attempt_id as attempt_id, generation_lease_owner as owner_id,
            generation_attempt_count as attempt_count, generation_dispatch_started_at as dispatch_started_at
          from signals where generation_attempt_count is not null and status = 'DRAFT'
            and generation_status in ('EXPANDING', 'MATCHING', 'WRITING')
            and (generation_lease_until <= clock_timestamp() or generation_attempt_deadline_at <= clock_timestamp())
          order by generation_lease_until, id limit ${remaining} for update skip locked`;
        for (const row of rows) {
          if (row.dispatch_started_at === null && row.attempt_count < params.maxAttempts) {
            const delay = integerOption(params.backoffForAttempt(row.attempt_count), "retry backoff", true);
            const changed = await tx<{ id: string }[]>`
              update signals set generation_status = 'RECEIVED', generation_error = null,
                generation_attempt_id = null, generation_lease_owner = null, generation_lease_until = null,
                generation_attempt_started_at = null, generation_attempt_deadline_at = null,
                generation_dispatch_started_at = null,
                generation_next_attempt_at = clock_timestamp() + ${delay} * interval '1 millisecond',
                updated_at = clock_timestamp()
              where id = ${row.id}::uuid and generation_attempt_id = ${row.attempt_id}::uuid
                and generation_lease_owner = ${row.owner_id}::uuid and status = 'DRAFT'
                and generation_status in ('EXPANDING', 'MATCHING', 'WRITING')
                and generation_dispatch_started_at is null
                and (generation_lease_until <= clock_timestamp() or generation_attempt_deadline_at <= clock_timestamp())
              returning id`;
            result.requeuedIds.push(...changed.map((item) => item.id));
          } else {
            const code: GenerationFailureCode = row.dispatch_started_at === null
              ? "GENERATION_RETRY_EXHAUSTED" : "GENERATION_OUTCOME_UNKNOWN";
            const changed = await tx<{ id: string }[]>`
              update signals set generation_status = 'FAILED', generation_error = ${code},
                generation_lease_owner = null, generation_lease_until = null,
                generation_next_attempt_at = null, updated_at = clock_timestamp()
              where id = ${row.id}::uuid and generation_attempt_id = ${row.attempt_id}::uuid
                and generation_lease_owner = ${row.owner_id}::uuid and status = 'DRAFT'
                and generation_status in ('EXPANDING', 'MATCHING', 'WRITING')
                and (generation_lease_until <= clock_timestamp() or generation_attempt_deadline_at <= clock_timestamp())
              returning id`;
            result.failedIds.push(...changed.map((item) => item.id));
          }
        }
        return result;
      });
    },

    async findGenerationAttemptOutcome(params: {
      signalId: string; attemptId: string;
    }): Promise<"COMPLETED" | "FAILED" | "ACTIVE" | "OBSOLETE"> {
      assertOpen();
      const [row] = await ownedDb.select({ status: signals.generationStatus }).from(signals).where(and(
        eq(signals.id, params.signalId), eq(signals.generationAttemptId, params.attemptId),
      )).limit(1);
      if (row === undefined) return "OBSOLETE";
      if (row.status === "COMPLETED" || row.status === "FAILED") return row.status;
      return "ACTIVE";
    },

    closeSignalGenerationRepository(params: { timeoutSeconds: number }): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      if (!Number.isFinite(params.timeoutSeconds) || params.timeoutSeconds < 0) {
        throw new Error("Invalid generation repository close timeout.");
      }
      closing = true;
      // Postgres.js end's deadline closes the owned sockets and settles pending
      // queries. The caller must also await its actual in-flight worker Promises.
      closePromise = client.end({ timeout: params.timeoutSeconds });
      return closePromise;
    },
  };
}

export const createSignalGenerationRepository = configureSignalGenerationRepository;
export type SignalGenerationRepository = ReturnType<typeof configureSignalGenerationRepository>;
