import { describe, expect, it } from "vitest";
import { isMySignalsResponse } from "./api-response-validators";
const point = { id: "d4000000-0000-4000-8000-000000000001", seedText: "合成私密种子", expandedText: "合成正文",
  createdAt: "2029-01-01T00:00:00Z", status: "DRAFT", resonanceCount: 1,
  frequencyProfile: { primaryBand: "meaning_deep_space", subFeeling: "effort_doubt", displayText: "意义深空 · 努力怀疑",
    coreNeed: "pause", emotionTone: "quiet", innerConflict: "pause", resonanceKeywords: ["pause"] } };
describe("bounded private history response", () => {
  it("accepts legacy responses and full totals beyond the current page", () => {
    expect(isMySignalsResponse({ signals: [point], totalResonanceCount: 1 })).toBe(true);
    expect(isMySignalsResponse({ signals: [point], totalResonanceCount: 501, totalSignalCount: 85,
      topSignal: { ...point, resonanceCount: 500 }, page: { limit: 80, hasMore: true, nextCursor: "c3ludGhldGlj" } })).toBe(true);
  });
  it("rejects unbounded samples and inconsistent pagination metadata", () => {
    const response = { signals: [point], totalResonanceCount: 1, totalSignalCount: 1, page: { limit: 80, hasMore: false } };
    expect(isMySignalsResponse({ ...response, signals: Array.from({ length: 81 }, () => point) })).toBe(false);
    expect(isMySignalsResponse({ ...response, totalSignalCount: 0 })).toBe(false);
    for (const page of [{ limit: 81, hasMore: false }, { limit: 0, hasMore: false }, { limit: 80, hasMore: true }, { limit: 80, hasMore: false, nextCursor: "bad" }]) {
      expect(isMySignalsResponse({ ...response, page })).toBe(false);
    }
  });
});
