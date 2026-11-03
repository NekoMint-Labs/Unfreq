import { afterEach, describe, expect, it, vi } from "vitest";
import * as provider from "../ai/provider.js";
import { calculateAiEvaluation } from "./ai-evaluation.js";

afterEach(() => vi.restoreAllMocks());

describe("admin Demo rule evaluation", () => {
  it("labels synthetic fixtures and excludes model and competition claims", () => {
    const result = calculateAiEvaluation();

    expect(result).toMatchObject({
      ablationStatus: "NOT_RUN",
      ablations: [],
      competitionEvidenceEligible: false,
      dataset: {
        judgmentSource: "synthetic-presets-not-human",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        version: "admin-rule-fixtures-v1",
      },
      evaluationKind: "DEMO_RULE_FIXTURES",
      modelQualityValidated: false,
      sampleSize: { classification: 4, matching: 2, moderation: 1, tags: 4 },
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      label: "Demo / 本地规则夹具", method: "RULE_BASELINE",
    });
    expect(result.limitations.join(" ")).toContain("未调用当前 E3");
    expect(result.limitations.join(" ")).toContain("不得作为参赛实测指标");
    expect(result.dataset).toEqual(calculateAiEvaluation().dataset);
  });

  it("reports measured numerators and denominators with fixture outputs", () => {
    const result = calculateAiEvaluation();
    expect(result.fixtureOutputs).toHaveLength(11);
    expect(result.groups[0].metrics).toMatchObject([
      { key: "classificationAccuracy", numerator: 4, denominator: 4, value: 100 },
      { key: "tagTopKHitRate", numerator: 2, denominator: 4, value: 50 },
      { key: "moderationRecall", numerator: 1, denominator: 1, value: 100 },
      { key: "matchTop1PresetHitRate", numerator: 2, denominator: 2, value: 100 },
    ]);
    expect(result.fixtureOutputs).toContainEqual({
      actual: ["迷茫", "夜晚"], expected: ["想念", "遗憾"], hit: false,
      id: "content-2", task: "tags",
    });
    expect(result.fixtureOutputs.filter((output) => output.task === "moderation")).toEqual([{
      actual: ["HIGH"], expected: ["MEDIUM", "HIGH"], hit: true,
      id: "content-4", task: "moderation",
    }]);
    for (const metric of result.groups[0].metrics) {
      expect(metric.method.length).toBeGreaterThan(0);
      expect(metric.value).toBe(Number((100 * metric.numerator / metric.denominator).toFixed(1)));
    }
  });

  it("recomputes from current fallback outputs instead of fixed percentages", () => {
    vi.spyOn(provider, "classifyFallback").mockReturnValue({
      channel: "STARMAP", confidence: 1, reason: "test fixture",
    });
    vi.spyOn(provider, "tagsFallback").mockReturnValue({ tags: [] });
    vi.spyOn(provider, "moderateFallback").mockReturnValue({
      action: "ALLOW", riskLevel: "LOW", reason: "test fixture",
    });
    const result = calculateAiEvaluation();

    expect(result.groups[0].metrics).toMatchObject([
      { numerator: 2, denominator: 4, value: 50 },
      { numerator: 0, denominator: 4, value: 0 },
      { numerator: 0, denominator: 1, value: 0 },
      { numerator: 2, denominator: 2, value: 100 },
    ]);
    expect(provider.classifyFallback).toHaveBeenCalledTimes(4);
    expect(provider.tagsFallback).toHaveBeenCalledTimes(4);
    expect(provider.moderateFallback).toHaveBeenCalledTimes(1);
    expect(result.ablations).toEqual([]);
  });
});
