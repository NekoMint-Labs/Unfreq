import { confirmPublicationSnapshot, digestPublicationContent } from "../../src/modules/signals/publication.js";
import { signalBandLabels } from "../../src/modules/signals/frequency-taxonomy.js";
import type { SignalRecord } from "../../src/modules/signals/types.js";
/** Historical author-confirmed synthetic fixtures only. Never imported by runtime code.
 * New publication previews deliberately omit these unverified classifications.
 */
export function confirmUnitPublication<T extends SignalRecord>(signal: T): T {
  const primaryBand = signal.primaryBand ?? signal.fingerprintJson.primaryBand;
  const content = { expandedText: signal.expandedText,
    ...(signal.authorFreqCode === null ? {} : { authorFreqCode: signal.authorFreqCode }),
    tags: [...new Set([signalBandLabels[primaryBand], ...signal.fingerprintJson.tags.slice(0, 2)])], primaryBand };
  signal.publicationVersion = 1;
  signal.publicationSnapshot = confirmPublicationSnapshot({ content, digest: digestPublicationContent(content), version: 0 }, new Date("2026-10-30T00:00:00Z"));
  return signal;
}
