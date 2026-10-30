import { confirmUnitPublication } from "./publication-fixture.js";
import { fixtureFingerprint } from "../integration/fixtures.js";
import type { SignalSemanticMatchRecord } from "../../src/modules/signals/types.js";
export function matchRecord(patch: Partial<SignalSemanticMatchRecord> = {}): SignalSemanticMatchRecord {
const record: SignalSemanticMatchRecord = confirmUnitPublication({
  publicationVersion: 0, publicationSnapshot: null, withdrawnAt: null, audioPublicationVersion: null,
  id: "00000000-0000-4000-8000-000000000501", authorId: "00000000-0000-4000-8000-000000000101", authorFreqCode: "FM-10.01", frequencyId: null,
  audioError: null, audioStatus: "NOT_REQUESTED", audioStorageKey: null, audioStorageKeyLeft: null, audioStorageKeyRight: null,
  audioUrl: null, audioUrlLeft: null, audioUrlRight: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  echoCount: 0, resonanceCount: 0, resonanceKeywords: null, expandedText: "synthetic public candidate", seedText: "synthetic candidate seed", rawInput: "synthetic candidate seed",
  fingerprintJson: fixtureFingerprint, followUpQuestion: null, galaxyPosition: null,
  embedding: [0.1, 0.2, 0.3], embeddingDimensions: 3, embeddingModel: "synthetic", embeddingProvider: "synthetic", embeddingVersion: "unit-v1", distance: 0.2,
  generationError: null, generationStatus: "COMPLETED", guestKey: null,
  coreNeed: null, emotionTone: null, innerConflict: null, matchSignalId: null, parentSignalId: null,
  primaryBand: "self_mirror", programJson: { bridgeNarration: "synthetic", closingQuestion: "synthetic?", hostIntro: "synthetic", leftSignalSummary: "synthetic", programTitle: "synthetic", shareQuote: "synthetic" },
  qualityReason: null, qualityScore: null, source: "human", status: "PUBLISHED", subFeeling: "self_acceptance", isKept: false,
});
  return { ...record, ...patch };
}
