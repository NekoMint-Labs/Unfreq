import { eq, sql } from "drizzle-orm";
import { maxSignalPublicationVersion, type SignalPublicationPreview, type SignalPublicationSnapshot } from "@unfreq/contracts/signals";
import { db } from "../../db/client.js";
import { signals, users } from "../../db/schema.js";
import { buildPublicationPreview, confirmPublicationSnapshot, parsePublicationSnapshot } from "./publication.js";
import { signalFingerprintSchema } from "./schemas.js";

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

export type ConfirmOwnedSignalInput = {
  id: string;
  actorId: string;
  expectedVersion: number;
  digest: string;
};

type ConfirmationFailure = { outcome: "NOT_FOUND" } | { outcome: "CONFLICT" } | { outcome: "FORBIDDEN" };

export type ConfirmOwnedSignalResult = {
  outcome: "PUBLISHED";
  id: string;
  publicationVersion: number;
  snapshot: SignalPublicationSnapshot;
} | ConfirmationFailure;

export type ReadOwnedPublicationPreviewResult = {
  outcome: "READY";
  preview: SignalPublicationPreview;
} | ConfirmationFailure;

export type SignalConfirmationRepository = {
  readOwnedPublicationPreview(input: { id: string; actorId: string }): Promise<ReadOwnedPublicationPreviewResult>;
  confirmOwnedSignalPublication(input: ConfirmOwnedSignalInput): Promise<ConfirmOwnedSignalResult>;
};

type LockedPublicationSignal = Pick<typeof signals.$inferSelect,
  "id" | "authorId" | "status" | "generationStatus" | "expandedText" | "fingerprintJson" |
  "primaryBand" | "publicationVersion" | "publicationSnapshot" | "withdrawnAt"
>;
type LockedPublicationCandidate = {
  outcome: "READY";
  signal: LockedPublicationSignal;
  preview: SignalPublicationPreview;
  existingSnapshot?: SignalPublicationSnapshot;
} | ConfirmationFailure;

const publicationFingerprintSchema = signalFingerprintSchema.pick({ primaryBand: true, tags: true });

async function readLockedPublicationCandidate(
  tx: Pick<typeof db, "select">,
  input: { id: string; actorId: string },
): Promise<LockedPublicationCandidate> {
  // Keep a single lock order: canonical account first, then the signal. SHARE
  // also fences status/FM changes committed while a stale session is in use.
  const [actor] = await tx.select({ status: users.status, freqCode: users.freqCode })
    .from(users).where(eq(users.id, input.actorId)).limit(1).for("share");
  const [signal] = await tx.select({
    id: signals.id, authorId: signals.authorId, status: signals.status,
    generationStatus: signals.generationStatus, expandedText: signals.expandedText,
    fingerprintJson: signals.fingerprintJson, primaryBand: signals.primaryBand,
    publicationVersion: signals.publicationVersion, publicationSnapshot: signals.publicationSnapshot,
    withdrawnAt: signals.withdrawnAt,
  }).from(signals).where(eq(signals.id, input.id)).limit(1).for("update");

  if (signal === undefined || signal.authorId === null || signal.authorId !== input.actorId ||
      signal.status === "HIDDEN" || signal.status === "DELETED") return { outcome: "NOT_FOUND" };
  if (actor === undefined || actor.status !== "ACTIVE") return { outcome: "FORBIDDEN" };
  if ((signal.status !== "DRAFT" && signal.status !== "PUBLISHED") ||
      signal.generationStatus !== "COMPLETED") return { outcome: "CONFLICT" };

  const fingerprint = publicationFingerprintSchema.safeParse(signal.fingerprintJson);
  if (!fingerprint.success) return { outcome: "CONFLICT" };
  let preview: SignalPublicationPreview;
  try {
    // This catch is confined to pure candidate validation. Storage/commit
    // errors remain rejected, never converted into consent or a retry.
    preview = buildPublicationPreview({
      authorId: signal.authorId, authorFreqCode: actor.freqCode,
      expandedText: signal.expandedText, fingerprintJson: fingerprint.data,
      generationStatus: signal.generationStatus, primaryBand: signal.primaryBand,
    }, signal.publicationVersion);
  } catch {
    return { outcome: "CONFLICT" };
  }
  const existingSnapshot = parsePublicationSnapshot(signal.publicationSnapshot);
  return { outcome: "READY", signal, preview,
    ...(existingSnapshot === undefined ? {} : { existingSnapshot }) };
}

function unchangedConfirmedSnapshot(candidate: Extract<LockedPublicationCandidate, { outcome: "READY" }>) {
  return candidate.signal.status === "PUBLISHED" && candidate.signal.withdrawnAt === null &&
    candidate.signal.publicationVersion > 0 && candidate.existingSnapshot?.digest === candidate.preview.digest
    ? candidate.existingSnapshot : undefined;
}

/** Private, transactionally consistent preview; this function makes no data writes. */
export async function readOwnedPublicationPreview(
  input: { id: string; actorId: string },
): Promise<ReadOwnedPublicationPreviewResult> {
  return db.transaction(async (tx) => {
    const candidate = await readLockedPublicationCandidate(tx, input);
    if (candidate.outcome !== "READY") return candidate;
    if (candidate.signal.publicationVersion >= maxSignalPublicationVersion &&
        unchangedConfirmedSnapshot(candidate) === undefined) return { outcome: "CONFLICT" };
    return { outcome: "READY", preview: candidate.preview };
  }, { isolationLevel: "read committed" });
}

/** Only this explicit, current candidate/version confirmation creates consent. */
export async function confirmOwnedSignalPublication(
  input: ConfirmOwnedSignalInput,
): Promise<ConfirmOwnedSignalResult> {
  return db.transaction(async (tx) => {
    const candidate = await readLockedPublicationCandidate(tx, input);
    if (candidate.outcome !== "READY") return candidate;
    if (candidate.signal.publicationVersion !== input.expectedVersion || candidate.preview.digest !== input.digest) {
      return { outcome: "CONFLICT" };
    }
    const existingSnapshot = unchangedConfirmedSnapshot(candidate);
    if (existingSnapshot !== undefined) {
      return { outcome: "PUBLISHED", id: candidate.signal.id,
        publicationVersion: candidate.signal.publicationVersion, snapshot: existingSnapshot };
    }
    if (candidate.signal.publicationVersion >= maxSignalPublicationVersion) return { outcome: "CONFLICT" };

    const [tick] = await tx.select({ milliseconds: sql`floor(extract(epoch from clock_timestamp()) * 1000)`.mapWith(Number) })
      .from(signals).where(eq(signals.id, candidate.signal.id)).limit(1);
    if (tick === undefined || !Number.isFinite(tick.milliseconds)) throw new Error("Publication database time is unavailable.");
    const confirmedAt = new Date(tick.milliseconds);
    const snapshot = confirmPublicationSnapshot(candidate.preview, confirmedAt);
    const [published] = await tx.update(signals).set({
      publicationSnapshot: snapshot, status: "PUBLISHED", withdrawnAt: null,
      publicationVersion: sql`${signals.publicationVersion} + 1`, updatedAt: confirmedAt,
      audioAttemptId: null, audioPublicationVersion: null, audioStatus: "NOT_REQUESTED", audioError: null,
    }).where(eq(signals.id, candidate.signal.id)).returning({ id: signals.id, publicationVersion: signals.publicationVersion });
    if (published === undefined) throw new Error("Signal confirmation did not return a row.");
    return { outcome: "PUBLISHED", ...published, snapshot };
  }, { isolationLevel: "read committed" });
}

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
