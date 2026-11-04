import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { signals } from "../../db/schema.js";
import { parsePublicationSnapshot } from "./publication.js";
import type { SignalRecord } from "./types.js";

// SQL narrows candidates before LIMIT. Runtime validation still verifies the
// complete whitelist and digest before any content is returned or dispatched.
export function publicSignalFilters() {
  return [eq(signals.status, "PUBLISHED"), eq(signals.generationStatus, "COMPLETED"),
    isNull(signals.withdrawnAt), gt(signals.publicationVersion, 0),
    isNotNull(signals.publicationSnapshot),
    sql<boolean>`${signals.publicationSnapshot}->>'kind' = 'AUTHOR_CONFIRMED'`];
}

export const publicSignalCondition = () => and(...publicSignalFilters());

export function isPublicSignal(signal: Pick<SignalRecord,
  "status" | "generationStatus" | "withdrawnAt" | "publicationVersion" | "publicationSnapshot"
>): boolean {
  return signal.status === "PUBLISHED" && signal.generationStatus === "COMPLETED" &&
    signal.withdrawnAt === null && Number.isSafeInteger(signal.publicationVersion) &&
    signal.publicationVersion > 0 && parsePublicationSnapshot(signal.publicationSnapshot) !== undefined;
}

export function publicationProjection(signal: SignalRecord, expectedVersion = signal.publicationVersion) {
  return { signal, snapshot: signal.publicationSnapshot, state: {
    status: signal.status, generationStatus: signal.generationStatus, withdrawnAt: signal.withdrawnAt,
    currentPublicationVersion: signal.publicationVersion, expectedPublicationVersion: expectedVersion,
  } };
}
