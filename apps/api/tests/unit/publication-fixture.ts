import { buildPublicationPreview, confirmPublicationSnapshot } from "../../src/modules/signals/publication.js";
import type { SignalRecord } from "../../src/modules/signals/types.js";
/** Synthetic unit fixtures only. Never imported by runtime code. */
export function confirmUnitPublication<T extends SignalRecord>(signal: T): T {
  signal.publicationVersion = 1;
  signal.publicationSnapshot = confirmPublicationSnapshot(buildPublicationPreview(signal, 0), new Date("2026-10-30T00:00:00Z"));
  return signal;
}
