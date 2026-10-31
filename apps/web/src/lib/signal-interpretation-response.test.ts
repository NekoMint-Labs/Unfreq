import { describe, expect, it } from "vitest";
import { isMySignalsResponse, isSignalResponse } from "./api-response-validators";

const profile = { coreNeed: "", displayText: "暂不解读", emotionTone: "", innerConflict: "",
  primaryBand: "self_mirror", subFeeling: "self_doubt", resonanceKeywords: [] };
const fingerprint = { ...profile, energy: 0, openness: 0, frequency: "SIG-SYNTHETIC", hiddenNeed: "",
  narrativeConflict: "", primaryEmotion: "", riskLevel: "LOW", secondaryEmotions: [], signalType: "",
  tags: [], theme: "", title: "这是一条合成表达" };
const detail = { id: "synthetic-owner", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  visibility: "PRIVATE_OWNER", status: "DRAFT", audioStatus: "NOT_REQUESTED", echoCount: 0,
  expandedText: "正文不会因为未知解读而丢失", rawInput: fingerprint.title, seedText: fingerprint.title,
  resonanceCount: 0, source: "human", isKept: false, matches: [],
  program: { bridgeNarration: "", closingQuestion: "", hostIntro: "", leftSignalSummary: "", programTitle: "", shareQuote: "" },
  publication: { state: "DRAFT", canPublish: false, canWithdraw: true, version: 0 },
};
function responses(interpretation: unknown, keywords: string[] = []) {
  const frequencyProfile = { ...profile, interpretation, resonanceKeywords: keywords };
  return {
    owner: { signal: { ...detail, frequencyProfile,
      fingerprint: { ...fingerprint, interpretation, resonanceKeywords: keywords } } },
    history: { signals: [{ id: detail.id, createdAt: detail.createdAt, expandedText: detail.expandedText,
      seedText: detail.seedText, status: detail.status, resonanceCount: 0, frequencyProfile }], totalResonanceCount: 0 },
  };
}

describe("interpretation metadata at the Web response boundary", () => {
  it.each([
    { version: 1, state: "unknown", source: "unknown" },
    { version: 1, state: "unknown", source: "rules" },
    { version: 1, state: "unverified", source: "provider" },
  ])("accepts neutral private projections and empty keywords for %j", (interpretation) => {
    const { owner, history } = responses(interpretation);
    expect(isSignalResponse(owner)).toBe(true);
    expect(isMySignalsResponse(history)).toBe(true);
  });

  it("keeps legacy nonempty profile responses compatible", () => {
    const { owner, history } = responses(undefined, ["旧标签"]);
    expect(isSignalResponse(owner)).toBe(true);
    expect(isMySignalsResponse(history)).toBe(true);
  });

  it.each([null, {}, { version: 2, state: "unknown", source: "unknown" },
    { version: 1, state: "verified", source: "provider" }, { version: 1, state: "unknown", source: "guessed" },
    { version: 1, state: "unknown", source: "provider" },
    { version: 1, state: "unverified", source: "rules" },
    { version: 1, state: "unknown", source: "unknown", privateProviderDetail: "must-not-leak" }])(
    "rejects invalid or extra interpretation metadata %j", (interpretation) => {
      const { owner, history } = responses(interpretation, ["保留关键词以单独检查元数据"]);
      expect(isSignalResponse(owner)).toBe(false);
      expect(isMySignalsResponse(history)).toBe(false);
    },
  );

  it("does not relax field types or keyword bounds for an unknown result", () => {
    const { owner, history } = responses({ version: 1, state: "unknown", source: "rules" });
    expect(isSignalResponse({ signal: { ...owner.signal, fingerprint: { ...owner.signal.fingerprint, coreNeed: null } } })).toBe(false);
    expect(isMySignalsResponse({ ...history, signals: [{ ...history.signals[0], frequencyProfile: {
      ...history.signals[0].frequencyProfile, resonanceKeywords: ["a", "b", "c", "d"],
    } }] })).toBe(false);
  });
});
