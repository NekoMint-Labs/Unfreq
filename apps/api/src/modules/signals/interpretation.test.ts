import { describe, expect, it } from "vitest";
import { fixtureFingerprint } from "../../../tests/integration/fixtures.js";
import { monthlyRecapFallback, signalFingerprintFallback } from "../ai/provider.js";
import { normalizeSignalFrequencyProfile } from "./frequency-taxonomy.js";
import { canDisplaySignalInterpretation, canReferenceSignalInterpretation, interpretationFromExecution, resolveSignalInterpretation } from "./interpretation.js";
import { buildPublicationPreview, confirmPublicationSnapshot, digestPublicationContent, parsePublicationSnapshot, projectPublicSignal } from "./publication.js";
import { getSignalFrequencyProfile, toSignalDetail } from "./service-mappers.js";
import { scoreSignalMatch } from "./service-matching.js";
import { signalFingerprintSchema, signalFrequencyProfileSchema } from "./schemas.js";
import type { SignalFingerprint, SignalRecord } from "./types.js";

function signal(fingerprint: SignalFingerprint): SignalRecord {
  const date = new Date("2026-11-01T00:00:00Z");
  return {
    id: "00000000-0000-4000-8000-000000000001", authorId: "00000000-0000-4000-8000-000000000002",
    authorFreqCode: "FM-10.01", frequencyId: null, guestKey: null, createdAt: date, updatedAt: date,
    audioError: null, audioStatus: "NOT_REQUESTED", audioStorageKey: null, audioStorageKeyLeft: null, audioStorageKeyRight: null,
    audioUrl: null, audioUrlLeft: null, audioUrlRight: null, audioPublicationVersion: null,
    echoCount: 0, resonanceCount: 0, expandedText: "作者待确认的正常正文。", seedText: "今天考试通过了，很开心。", rawInput: "今天考试通过了，很开心。",
    fingerprintJson: fingerprint, followUpQuestion: null, galaxyPosition: { x: .1, y: .2, z: .3 },
    embedding: null, embeddingDimensions: null, embeddingModel: null, embeddingProvider: null, embeddingVersion: null,
    generationError: null, generationStatus: "COMPLETED", coreNeed: fingerprint.coreNeed, emotionTone: fingerprint.emotionTone,
    innerConflict: fingerprint.innerConflict, primaryBand: fingerprint.primaryBand, subFeeling: fingerprint.subFeeling,
    resonanceKeywords: fingerprint.resonanceKeywords, matchSignalId: null, parentSignalId: null,
    programJson: { bridgeNarration: "正文", closingQuestion: "继续吗？", hostIntro: "正文", leftSignalSummary: "正文", programTitle: "正文", shareQuote: "正文" },
    qualityReason: null, qualityScore: null, source: "human", status: "DRAFT", isKept: false,
    publicationVersion: 0, publicationSnapshot: null, withdrawnAt: null,
  };
}

describe("conservative interpretation policy", () => {
  it.each(["今天吃到喜欢的冰淇淋。", "考试通过了，我很开心。", "月亮今天请假，太阳来加班。", "最近考试让我焦虑。"])(
    "does not turn rule fallback into a personal conclusion: %s", (text) => {
      const fingerprint = signalFingerprintFallback(text);
      const row = { ...signal(fingerprint), seedText: text, rawInput: text };
      const detail = toSignalDetail(row);
      expect(detail.seedText).toBe(text);
      expect(detail.expandedText).toBe(row.expandedText);
      expect(detail.fingerprint.interpretation).toEqual({ version: 1, state: "unknown", source: "rules" });
      expect(detail.fingerprint.tags).toEqual([]);
      expect(detail.frequencyProfile.resonanceKeywords).toEqual([]);
      expect(detail.fingerprint.displayText).toBe("暂不作心理解读");
      expect(JSON.stringify(detail.fingerprint)).not.toMatch(/想靠近别人|被看见|确认自己的感受能被理解|自我怀疑/u);
      expect(signalFingerprintSchema.safeParse(detail.fingerprint).success).toBe(true);
      expect(signalFrequencyProfileSchema.safeParse(detail.frequencyProfile).success).toBe(true);
      const preview = buildPublicationPreview(row, 0);
      expect(preview.content).toEqual({ expandedText: row.expandedText, authorFreqCode: row.authorFreqCode, tags: [] });
      expect(confirmPublicationSnapshot(preview, row.createdAt).content).toEqual(preview.content);
    },
  );

  it("keeps existing moderation risk separate from unavailable interpretation", () => {
    const detail = toSignalDetail(signal(signalFingerprintFallback("这是一条诈骗广告。")));
    expect(detail.fingerprint.riskLevel).toBe("HIGH");
    expect(detail.fingerprint.interpretation?.state).toBe("unknown");
  });

  it("uses neutral monthly fallback copy without inventing recurring psychological themes", () => {
    const recap = monthlyRecapFallback("今天吃到喜欢的冰淇淋。月亮今天请假。");
    expect(recap.themeWords).toEqual(["本月表达"]);
    expect(recap.summary).not.toMatch(/迷茫|孤独|难说|被理解|自我怀疑/u);
  });

  it("suppresses legacy private interpretation without modifying stored JSON, coordinates or confirmed content", () => {
    const { interpretation: _oldSource, ...legacy } = fixtureFingerprint;
    const row = signal(legacy);
    const content = { expandedText: row.expandedText, authorFreqCode: row.authorFreqCode!, tags: ["自我镜像", "旧标签"], primaryBand: "self_mirror" as const };
    const snapshot = confirmPublicationSnapshot({ content, digest: digestPublicationContent(content), version: 0 }, row.createdAt);
    row.publicationSnapshot = snapshot; row.publicationVersion = 1; row.status = "PUBLISHED";
    const before = JSON.stringify(row);
    expect(toSignalDetail(row).fingerprint).toMatchObject({ interpretation: { state: "unknown", source: "unknown" }, tags: [], coreNeed: "暂不作心理解读" });
    expect(getSignalFrequencyProfile(row).resonanceKeywords).toEqual([]);
    expect(parsePublicationSnapshot(snapshot)).toEqual(snapshot);
    const projected = projectPublicSignal({ signal: row, snapshot,
      state: { status: "PUBLISHED", generationStatus: "COMPLETED", withdrawnAt: null, currentPublicationVersion: 1, expectedPublicationVersion: 1 } });
    expect(projected?.tags).toEqual(content.tags);
    expect(projected?.primaryBand).toBe(content.primaryBand);
    expect(JSON.stringify(row)).toBe(before);
    expect(buildPublicationPreview(row, 1).content.tags).toEqual([]);
  });

  it.each([undefined, null, {}, { version: 1, state: "verified", source: "provider" },
    { version: 1, state: "unverified", source: "rules" }, { version: 1, state: "unknown", source: "provider" }])(
    "fails closed on missing or invalid bookkeeping %j", (value) => {
      expect(resolveSignalInterpretation(value)).toEqual({ version: 1, state: "unknown", source: "unknown" });
      expect(canDisplaySignalInterpretation(value)).toBe(false);
      expect(canReferenceSignalInterpretation(value)).toBe(false);
    },
  );

  it("separates provider attribution for algorithms from permission to display a personal claim", () => {
    const source = interpretationFromExecution({ source: "provider" });
    expect(source).toEqual({ version: 1, state: "unverified", source: "provider" });
    expect(canReferenceSignalInterpretation(source)).toBe(true);
    expect(canDisplaySignalInterpretation(source)).toBe(false);
    expect(buildPublicationPreview(signal({ ...fixtureFingerprint, interpretation: source }), 0).content.tags).toEqual([]);
  });

  it("does not award rule similarity for shared unknown placeholders or legacy enum values", () => {
    const unknown = signalFingerprintFallback("今天好天气。");
    const candidate = signal(unknown);
    expect(scoreSignalMatch(unknown, candidate)).toBe(0);
    expect(scoreSignalMatch(fixtureFingerprint, candidate)).toBe(0);
    const { interpretation: _source, ...legacy } = fixtureFingerprint;
    expect(scoreSignalMatch(fixtureFingerprint, signal(legacy))).toBe(0);
    expect(scoreSignalMatch(fixtureFingerprint, signal(fixtureFingerprint))).toBe(40);
    const profile = normalizeSignalFrequencyProfile({ fallbackText: "今天很开心" });
    expect(profile.displayText).toBe("暂不作心理解读");
    expect(profile.resonanceKeywords).toEqual([]);
  });
});
