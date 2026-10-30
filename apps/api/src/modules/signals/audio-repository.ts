import { publicSignalCondition, isPublicSignal } from "./publication-policy.js";
import { parsePublicationSnapshot } from "./publication.js";
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

const publicAudio = publicSignalCondition;
const ownedAudio = (attempt: AudioAttempt) => and(publicAudio(), eq(signals.id, attempt.signal.id),
  eq(signals.audioAttemptId, attempt.attemptId), eq(signals.audioStatus, "PENDING"),
  eq(signals.publicationVersion, attempt.signal.publicationVersion), eq(signals.audioPublicationVersion, attempt.signal.publicationVersion));
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
    return row === undefined || !isPublicSignal(toSignalRecord(row)) ? undefined : toSignalRecord(row);
  }

  return {
    readPublished,
    async claim(id: string, expectedVersion?: number): Promise<AudioClaimResult> {
      assertOpen();
      const candidate = await readPublished(id);
      if (candidate === undefined || (expectedVersion !== undefined && candidate.publicationVersion !== expectedVersion)) return { outcome: "UNAVAILABLE" };
      const attemptId = randomUUID();
      const [row] = await db.update(signals).set({ audioStatus: "PENDING", audioError: null,
        audioAttemptId: attemptId, audioPublicationVersion: signals.publicationVersion, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(signals.id, id), publicAudio(), eq(signals.publicationVersion, candidate.publicationVersion), or(inArray(signals.audioStatus, ["NOT_REQUESTED", "FAILED"]), isNull(signals.audioPublicationVersion), sql`${signals.audioPublicationVersion} <> ${signals.publicationVersion}`)))
        .returning(returningSnapshot);
      if (row !== undefined) {
        const signal = toSignalRecord(row);
        const snapshot = parsePublicationSnapshot(signal.publicationSnapshot);
        if (snapshot === undefined) return { outcome: "UNAVAILABLE" };
        return { outcome: "CLAIMED", attempt: { attemptId, signal: { ...signal, expandedText: snapshot.content.expandedText } } };
      }
      const signal = await readPublished(id);
      if (signal === undefined) return { outcome: "UNAVAILABLE" };
      if (signal.audioPublicationVersion === signal.publicationVersion && (signal.audioStatus === "PENDING" || signal.audioStatus === "READY")) return { outcome: "CACHED", signal };
      // Do not repeat a claim after an indeterminate state transition.
      throw new Error("Audio claim state changed.");
    },
    async markUnavailable(id: string, expectedVersion?: number): Promise<SignalRecord | undefined> {
      assertOpen();
      const [row] = await db.update(signals).set({ audioStatus: "FAILED", audioError: "TTS provider is not configured.",
        updatedAt: sql`clock_timestamp()` })
        .where(and(eq(signals.id, id), publicAudio(), expectedVersion === undefined ? undefined : eq(signals.publicationVersion, expectedVersion), isNull(signals.audioAttemptId),
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
