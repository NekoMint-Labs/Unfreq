import { describe, expect, it } from "vitest";
import { composeMatchScore, cosineRelevance } from "./match-scoring.js";
import { normalizeRerankerScore, parseRerankerResponsePayload } from "../ai/reranker-adapter.js";

describe("matching relevance ranges", () => {
  it("composes one normalized retrieval scale with the existing forty-point rules", () => {
    expect(composeMatchScore(0.9, 40)).toBe(94);
    expect(composeMatchScore(undefined, 40)).toBe(40);
    expect(composeMatchScore(cosineRelevance(0), 0)).toBe(60);
    expect(normalizeRerankerScore(90, "zero_to_hundred")).toBe(0.9);
    expect(normalizeRerankerScore(0.9, "zero_to_one")).toBe(0.9);
    expect(normalizeRerankerScore(90, "zero_to_one")).toBeUndefined();
    expect(normalizeRerankerScore(0.9, "guess")).toBeUndefined();
  });
  it.each([Number.NaN, Infinity, -0.1, 1.1])("rejects invalid normalized relevance %s", (score) => {
    expect(() => composeMatchScore(score, 40)).toThrow();
  });
  it("rejects incomplete, duplicated, unknown or mixed-range rerank batches together", () => {
    const candidates = [{ id: "a", expandedText: "a" }, { id: "b", expandedText: "b" }];
    const parse = (results: unknown[], scoreScale = "zero_to_one") => parseRerankerResponsePayload({ candidates, provider: "generic", payload: { results }, scoreScale });
    expect(parse([{ id: "a", score: 90 }, { id: "b", score: 80 }], "zero_to_hundred").map((item) => item.score)).toEqual([0.9, 0.8]);
    for (const results of [[{ id: "a", score: 0.9 }], [{ id: "a", score: 0.9 }, { id: "a", score: 0.8 }],
      [{ id: "a", score: 0.9 }, { id: "unknown", score: 0.8 }], [{ id: "a", score: 0.9 }, { id: "b", score: 80 }]]) {
      expect(parse(results)).toEqual([]);
    }
  });
});
