import { describe, expect, it } from "vitest";
import { normalizeRerankerScore, parseRerankerResponsePayload } from "./reranker-adapter.js";
import { composeMatchScore, cosineRelevance } from "../signals/match-scoring.js";

const candidates = [{ id: "a", expandedText: "synthetic a" }, { id: "b", expandedText: "synthetic b" }];
const parse = (results: unknown, scoreScale: unknown = "zero_to_one") => parseRerankerResponsePayload({
  candidates, payload: { results }, provider: "generic", scoreScale,
});
describe("explicit relevance ranges", () => {
  it.each(["zero_to_one", "zero_to_hundred"] as const)("normalizes %s monotonically and retains the raw scale", (scale) => {
    const max = scale === "zero_to_one" ? 1 : 100;
    expect([0, 0.2, 0.9, 1].map((value) => normalizeRerankerScore(value * max, scale))).toEqual([0, 0.2, 0.9, 1]);
    expect(parse([{ id: "a", score: 0.8 * max }, { id: "b", score: 0.2 * max }], scale)[0])
      .toMatchObject({ id: "a", rawScore: 0.8 * max, rawScale: scale, score: 0.8 });
  });
  it.each([-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.01, 80, "0.8", null, undefined])("does not clamp or guess the range of %s", (score) => {
    expect(normalizeRerankerScore(score, "zero_to_one")).toBeUndefined();
    expect(parse([{ id: "a", score }, { id: "b", score: 0.8 }])).toEqual([]);
  });
  it.each([undefined, "", "logit", "auto"])("rejects an undeclared/unsupported range %s", (scale) => {
    expect(normalizeRerankerScore(0.8, scale)).toBeUndefined();
  });
  it.each([
    [], [{ id: "a", score: 0.9 }], [{ id: "a", score: 0.9 }, { id: "a", score: 0.8 }],
    [{ id: "a", score: 0.9 }, { id: "unknown", score: 0.8 }], [null, { id: "b", score: 0.8 }],
    [{ score: 0.9 }, { id: "b", score: 0.8 }], [{ id: "a", score: 0.9 }, { id: "b", score: 0.8 }, { id: "c", score: 0.7 }],
  ].map((results) => [results]))("rejects the entire malformed or incomplete batch %#", (results) => { expect(parse(results)).toEqual([]); });
  it("maps SiliconFlow indexes only within the supplied candidate set", () => {
    const params = { candidates, provider: "siliconflow", scoreScale: "zero_to_hundred" };
    expect(parseRerankerResponsePayload({ ...params, payload: { results: [{ index: 1, relevance_score: 80 }, { index: 0, relevance_score: 20 }] } }))
      .toMatchObject([{ id: "b", score: 0.8 }, { id: "a", score: 0.2 }]);
    for (const index of [-1, 2, 0.5, Number.NaN]) expect(parseRerankerResponsePayload({ ...params,
      payload: { results: [{ index, relevance_score: 80 }, { index: 0, relevance_score: 20 }] } })).toEqual([]);
  });
});
describe("common matching scale with unchanged blend weights", () => {
  it("keeps cosine and rule contributions on declared scales", () => {
    expect([0, 1, 2].map(cosineRelevance)).toEqual([1, 0.5, 1 / 3]);
    expect(composeMatchScore(0.9, 40)).toBe(94);
    expect(composeMatchScore(0.9, 0)).toBe(54);
    expect(composeMatchScore(undefined, 40)).toBe(40);
    expect(composeMatchScore(1, 40)).toBe(100);
    expect(composeMatchScore(0, 0)).toBe(0);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 2.1])("rejects invalid cosine distance %s", (distance) => { expect(() => cosineRelevance(distance)).toThrow(); });
  it("rejects undeclared normalized or rule scores", () => {
    for (const score of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.1]) expect(() => composeMatchScore(score, 40)).toThrow();
    for (const score of [-1, 41, Number.NaN]) expect(() => composeMatchScore(0.8, score)).toThrow();
  });
});
