import { describe, expect, it } from "vitest";
import { calculateAiEvaluation } from "./ai-evaluation.js";

describe("admin ai evaluation", () => {
  it("calculates fixed baseline and final method metrics", () => {
    const result = calculateAiEvaluation();

    expect(result.sampleSize).toMatchObject({
      classification: 4,
      matching: 2,
      moderation: 1,
      tags: 4,
    });
    expect(result.groups).toHaveLength(3);
    expect(result.groups.map((group) => group.method)).toEqual([
      "RANDOM_BASELINE",
      "RULE_BASELINE",
      "FINAL",
    ]);
    expect(
      result.groups
        .find((group) => group.method === "FINAL")
        ?.metrics.find((metric) => metric.key === "matchTopKRelevance")?.value,
    ).toBe(100);
  });

  it("returns ablation rows for poster comparison", () => {
    const result = calculateAiEvaluation();

    expect(result.ablations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "完整方案",
          matchTopKRelevance: 100,
        }),
        expect.objectContaining({
          label: "去除语义信号",
          matchTopKRelevance: 50,
        }),
      ]),
    );
  });
});
