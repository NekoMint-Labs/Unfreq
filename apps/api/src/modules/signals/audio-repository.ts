import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../../config/env.js";
import * as schema from "../../db/schema.js";
import { signals, users } from "../../db/schema.js";
import { signalSelection, toSignalRecord } from "./repository.js";
import type { SignalRecord } from "./types.js";

export type AudioAttempt = Readonly<{ signal: SignalRecord; attemptId: string }>;
export type AudioFailureCode = "AUDIO_UNAVAILABLE" | "AUDIO_RATE_LIMITED" | "AUDIO_PROTECTION_UNAVAILABLE" | "AUDIO_CANCELLED";
export type AudioClaimResult = { outcome: "CLAIMED"; attempt: AudioAttempt } |
  { outcome: "CACHED"; signal: SignalRecord } | { outcome: "UNAVAILABLE" };

const publicAudio = () => and(eq(signals.status, "PUBLISHED"), eq(signals.generationStatus, "COMPLETED"));
const ownedAudio = (attempt: AudioAttempt) => and(publicAudio(), eq(signals.id, attempt.signal.id),
  eq(signals.audioAttemptId, attempt.attemptId), eq(signals.audioStatus, "PENDING"));
const returningSnapshot = {
  ...signalSelection,
  authorFreqCode: sql<string | null>`(select ${users.freqCode} from ${users} where ${users.id} = ${signals.authorId})`,
};

export function createSignalAudioRepository(options: {
  statementTimeoutMs: number; lockTimeoutMs: number; maxConnections?: number;
}) {
  if (!Number.isSafeInteger(options.statementTimeoutMs) || options.statementTimeoutMs <= 0 ||
      !Number.isSafeInteger(options.lockTimeoutMs) || options.lockTimeoutMs <= 0 ||
      options.lockTimeoutMs >= options.statementTimeoutMs ||
      !Number.isSafeInteger(options.maxConnections ?? 2) || (options.maxConnections ?? 2) <= 0) {
    throw new Error("Invalid audio repository configuration.");
  }
  const client = postgres(env.databaseUrl, {
    prepare: false, max: options.maxConnections ?? 2,
    connect_timeout: Math.ceil(env.healthDependencyTimeoutMs / 1000),
    connection: { application_name: "unfreq-audio-worker", statement_timeout: options.statementTimeoutMs,
      lock_timeout: options.lockTimeoutMs, idle_in_transaction_session_timeout: options.statementTimeoutMs },
  });
  const db = drizzle(client, { schema });
  let closed = false;
  let closePromise: Promise<void> | undefined;
  function assertOpen() { if (closed) throw new Error("Audio repository is closed."); }

  async function readPublished(id: string): Promise<SignalRecord | undefined> {
    assertOpen();
    const [row] = await db.select(signalSelection).from(signals).leftJoin(users, eq(signals.authorId, users.id))
      .where(and(eq(signals.id, id), publicAudio())).limit(1);
    return row === undefined ? undefined : toSignalRecord(row);
  }

  return {
    readPublished,
    async claim(id: string): Promise<AudioClaimResult> {
      assertOpen();
      const attemptId = randomUUID();
      const [row] = await db.update(signals).set({ audioStatus: "PENDING", audioError: null,
        audioAttemptId: attemptId, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(signals.id, id), publicAudio(), inArray(signals.audioStatus, ["NOT_REQUESTED", "FAILED"])))
        .returning(returningSnapshot);
      if (row !== undefined) return { outcome: "CLAIMED", attempt: { attemptId, signal: toSignalRecord(row) } };
      const signal = await readPublished(id);
      if (signal === undefined) return { outcome: "UNAVAILABLE" };
      if (signal.audioStatus === "PENDING" || signal.audioStatus === "READY") return { outcome: "CACHED", signal };
      // Do not repeat a claim after an indeterminate state transition.
      throw new Error("Audio claim state changed.");
    },
    async markUnavailable(id: string): Promise<SignalRecord | undefined> {
      assertOpen();
      const [row] = await db.update(signals).set({ audioStatus: "FAILED", audioError: "TTS provider is not configured.",
        updatedAt: sql`clock_timestamp()` })
        .where(and(eq(signals.id, id), publicAudio(), isNull(signals.audioAttemptId),
          inArray(signals.audioStatus, ["NOT_REQUESTED", "FAILED"]))).returning(returningSnapshot);
      return row === undefined ? readPublished(id) : toSignalRecord(row);
    },
    async isOwnedPublic(attempt: AudioAttempt): Promise<boolean> {
      assertOpen();
      return (await db.select({ id: signals.id }).from(signals).where(ownedAudio(attempt)).limit(1)).length !== 0;
    },
    async ready(attempt: AudioAttempt, storageKey: string, url: string): Promise<boolean> {
      assertOpen();
      const rows = await db.update(signals).set({ audioStatus: "READY", audioError: null,
        audioStorageKey: storageKey, audioStorageKeyLeft: storageKey, audioStorageKeyRight: storageKey,
        audioUrl: url, audioUrlLeft: url, audioUrlRight: url, updatedAt: sql`clock_timestamp()` })
        .where(ownedAudio(attempt)).returning({ id: signals.id });
      return rows.length !== 0;
    },
    async failed(attempt: AudioAttempt, code: AudioFailureCode): Promise<boolean> {
      assertOpen();
      const rows = await db.update(signals).set({ audioStatus: "FAILED", audioError: code, updatedAt: sql`clock_timestamp()` })
        .where(ownedAudio(attempt)).returning({ id: signals.id });
      return rows.length !== 0;
    },
    async outcome(attempt: AudioAttempt, storageKey: string): Promise<"READY" | "PENDING" | "FAILED" | "OBSOLETE"> {
      assertOpen();
      const [row] = await db.select({ attemptId: signals.audioAttemptId, status: signals.audioStatus,
        main: signals.audioStorageKey, left: signals.audioStorageKeyLeft, right: signals.audioStorageKeyRight })
        .from(signals).where(eq(signals.id, attempt.signal.id)).limit(1);
      if (row?.attemptId !== attempt.attemptId) return "OBSOLETE";
      if (row.status === "READY" && [row.main, row.left, row.right].includes(storageKey)) return "READY";
      return row.status === "PENDING" || row.status === "FAILED" ? row.status : "OBSOLETE";
    },
    async isFileReferenced(storageKey: string): Promise<boolean> {
      assertOpen();
      return (await db.select({ id: signals.id }).from(signals).where(or(eq(signals.audioStorageKey, storageKey),
        eq(signals.audioStorageKeyLeft, storageKey), eq(signals.audioStorageKeyRight, storageKey))).limit(1)).length !== 0;
    },
    close(options: { timeoutSeconds: number }): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds < 0) throw new Error("Invalid audio repository close timeout.");
      closed = true;
      closePromise = client.end({ timeout: options.timeoutSeconds });
      return closePromise;
    },
  };
}

export type SignalAudioRepository = ReturnType<typeof createSignalAudioRepository>;
