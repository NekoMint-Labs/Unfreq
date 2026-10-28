import { eq, sql } from "drizzle-orm";
import { maxSignalPublicationVersion } from "@unfreq/contracts/signals";
import { db } from "../../db/client.js";
import { signals } from "../../db/schema.js";

export type WithdrawOwnedSignalInput = {
  id: string;
  actorId: string;
  expectedVersion: number;
};

export type WithdrawOwnedSignalResult =
  | { outcome: "WITHDRAWN"; id: string; publicationVersion: number }
  | { outcome: "NOT_FOUND" }
  | { outcome: "CONFLICT" };

export type SignalPublicationRepository = {
  withdrawOwnedSignal(input: WithdrawOwnedSignalInput): Promise<WithdrawOwnedSignalResult>;
};

/** Records the author's privacy intent without changing moderation or publication consent. */
export async function withdrawOwnedSignal(
  input: WithdrawOwnedSignalInput,
): Promise<WithdrawOwnedSignalResult> {
  return db.transaction(async (tx) => {
    const [signal] = await tx.select({
      id: signals.id,
      authorId: signals.authorId,
      frequencyId: signals.frequencyId,
      status: signals.status,
      withdrawnAt: signals.withdrawnAt,
      publicationVersion: signals.publicationVersion,
      generationStatus: signals.generationStatus,
      generationAttemptCount: signals.generationAttemptCount,
      audioStatus: signals.audioStatus,
      audioAttemptId: signals.audioAttemptId,
    }).from(signals).where(eq(signals.id, input.id)).limit(1).for("update");

    if (signal === undefined || signal.status === "DELETED" ||
        (signal.authorId ?? signal.frequencyId) !== input.actorId) {
      return { outcome: "NOT_FOUND" };
    }

    // A retry after a committed withdrawal succeeds without changing any field,
    // even if the caller still carries the version preceding that withdrawal.
    if (signal.withdrawnAt !== null) {
      return { outcome: "WITHDRAWN", id: signal.id, publicationVersion: signal.publicationVersion };
    }
    if (signal.publicationVersion !== input.expectedVersion ||
        signal.publicationVersion >= maxSignalPublicationVersion) return { outcome: "CONFLICT" };

    const stopGeneration = signal.generationAttemptCount !== null &&
      ["RECEIVED", "EXPANDING", "MATCHING", "WRITING"].includes(signal.generationStatus);
    const stopAudio = signal.audioStatus === "PENDING" && signal.audioAttemptId !== null;
    const [withdrawn] = await tx.update(signals).set({
      withdrawnAt: sql`clock_timestamp()`,
      publicationVersion: sql`${signals.publicationVersion} + 1`,
      ...(stopGeneration ? {
        generationStatus: "FAILED" as const,
        generationError: "GENERATION_SUPERSEDED",
        generationLeaseOwner: null,
        generationLeaseUntil: null,
        generationNextAttemptAt: null,
      } : {}),
      ...(stopAudio ? {
        audioStatus: "FAILED" as const,
        audioError: "AUDIO_SUPERSEDED",
        audioAttemptId: null,
      } : {}),
    }).where(eq(signals.id, signal.id)).returning({
      id: signals.id,
      publicationVersion: signals.publicationVersion,
    });

    if (withdrawn === undefined) throw new Error("Signal withdrawal did not return a row.");
    return { outcome: "WITHDRAWN", ...withdrawn };
  }, { isolationLevel: "read committed" });
}
