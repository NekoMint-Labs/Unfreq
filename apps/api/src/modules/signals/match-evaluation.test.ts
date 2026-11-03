import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateMatchRun, summarizeMatchEvaluation, type MatchEvaluationRun } from "./match-evaluation.js";
import { resolveMatchPolicy } from "./match-policy.js";

const sample: MatchEvaluationRun = { queryId: "synthetic", judgments: { a: 3, b: 1, unrelated: 0 }, semanticIds: ["a", "a"],
  poolIds: ["a", "b"], resultIds: ["b", "a"], latencyMs: 10, embeddingCalls: 1, rerankerCalls: 1, requestBytes: 200 };
describe("reproducible synthetic matching evaluation", () => {
  it("freezes the synthetic corpus and does not call its labels human judgments", () => {
    const file = new URL("../../../tests/fixtures/e3-matches.v1.json", import.meta.url);
    const bytes = readFileSync(file);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(readFileSync(new URL("../../../tests/fixtures/e3-matches.v1.sha256", import.meta.url), "utf8").trim());
    const data = JSON.parse(bytes.toString());
    expect(data).toMatchObject({ version: "e3-synthetic-v1", judgmentSource: "synthetic-presets-not-human", humanRelevance: null });
    expect(data.cases).toHaveLength(4);
  });
  it("computes Recall and the declared nDCG variant against hand-computed values", () => {
    const result = evaluateMatchRun(sample);
    const expected = (1 + 7 / Math.log2(3)) / (7 + 1 / Math.log2(3));
    expect(result).toMatchObject({ semanticRecallAtK: .5, poolRecall: 1, noMatch: false });
    expect(result.ndcgAt3).toBeCloseTo(expected, 12);
    expect(evaluateMatchRun({ ...sample, resultIds: ["a", "b"] }).ndcgAt3).toBe(1);
  });
  it("reports empty-truth queries independently without inventing an nDCG or human score", () => {
    const report = summarizeMatchEvaluation([sample, { ...sample, queryId: "none", judgments: { unrelated: 0 }, semanticIds: ["unrelated"], poolIds: ["unrelated"], resultIds: [] }]);
    expect(report).toMatchObject({ queries: 2, queriesWithRelevantLabels: 1, noMatchRate: .5, falseMatchQueryRate: 0,
      humanRelevance: null, currencyCost: null, modelQualityValidated: false, embeddingCalls: 2, rerankerCalls: 2 });
    expect(evaluateMatchRun({ ...sample, judgments: { unrelated: 0 }, semanticIds: ["unrelated"], poolIds: ["unrelated"], resultIds: ["unrelated"] })).toMatchObject({ ndcgAt3: null, falseMatchQuery: true });
  });
  it("rejects invalid labels/results and unbounded policy knobs", () => {
    expect(() => evaluateMatchRun({ ...sample, judgments: { a: 4 } })).toThrow();
    expect(() => evaluateMatchRun({ ...sample, resultIds: ["a", "a"] })).toThrow();
    expect(() => summarizeMatchEvaluation([])).toThrow();
    for (const patch of [{ semanticCandidates: 51 }, { minScore: Number.NaN }, { maxRerankCharacters: 100001 }]) {
      expect(() => resolveMatchPolicy({ semanticCandidates: 12, ruleCandidates: 24, minScore: 80, maxRerankCharacters: 12000, ...patch })).toThrow();
    }
  });
});
