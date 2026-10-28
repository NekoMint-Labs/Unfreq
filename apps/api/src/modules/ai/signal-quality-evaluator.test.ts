import { describe, expect, it } from "vitest";
import { signalPrimaryBands } from "../signals/frequency-taxonomy.js";
import { signalQualityFixtures } from "./signal-quality-fixtures.js";
import {
  buildSignalQualityMarkdownReport,
  evaluateDefaultSignalQualityFixtures,
  evaluateSignalQuality,
  evaluateSignalQualityBatch,
} from "./signal-quality-evaluator.js";

describe("signal quality evaluator", () => {
  it("provides fixed fixtures across every primary signal band", () => {
    expect(new Set(signalQualityFixtures.map((fixture) => fixture.primaryBand))).toEqual(
      new Set(signalPrimaryBands),
    );
  });

  it("penalizes obvious AI cliche and advice text", () => {
    const result = evaluateSignalQuality(
      "我想被看见，也想和自己和解，真正重要的不是答案，而是允许自己慢下来。",
    );

    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.passed).toBe(false);
    expect(result.triggeredTerms).toEqual(
      expect.arrayContaining(["被看见", "和解", "答案", "允许自己"]),
    );
  });

  it("penalizes the old repeated signal expansion template", () => {
    const result = evaluateSignalQuality(
      "我把这句话留在心里：sekai..。窗外车声慢下来，桌面还摊着没收好的纸，我把外套搭回椅背，口袋里的钥匙轻轻响了一下。我没有急着把它说出口，只是突然发现，自己已经很久没有把真实感受放到前面。",
    );

    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.passed).toBe(false);
    expect(result.triggeredTerms).toEqual(
      expect.arrayContaining(["我把这句话留在心里", "我没有急着把它说出口", "真实感受放到前面"]),
    );
  });

  it("penalizes seed wrapper phrasing from provider expansions", () => {
    const result = evaluateSignalQuality(
      "我把这句种子放在夜里反复看：今晚想把这段匿名信号留在这里。屏幕暗下去的时候，我把杯沿转了一圈，又停住，像在等一个不会来的回应。",
    );

    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.triggeredTerms).toEqual(expect.arrayContaining(["我把这句种子"]));
  });

  it("rewards concrete first-person scene text", () => {
    const result = evaluateSignalQuality(
      "我在末班地铁把那句话删掉，怕一发出去，就再也装不了平静，只好继续站着。",
    );

    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "first-person", passed: true }),
        expect.objectContaining({ key: "concrete-anchor", passed: true }),
        expect.objectContaining({ key: "gesture-detail", passed: true }),
      ]),
    );
  });

  it("prints fixture names, scores, checks, and short reasons in markdown", () => {
    const evaluation = evaluateSignalQualityBatch([
      {
        fixtureName: "固定样本",
        seedText: "我不想再解释了。",
        text: "我把聊天框里的那句算了删掉，手机扣在桌上，杯里的冰化完了也没人问我刚才怎么停住。",
      },
    ]);
    const report = buildSignalQualityMarkdownReport(evaluation);

    expect(report).toContain("# AI Signal Quality Evaluation");
    expect(report).toContain("## 固定样本");
    expect(report).toContain("Score:");
    expect(report).toContain("Checks:");
    expect(report).toContain("Reasons:");
    expect(report).toContain("[x] 第一人称");
  });

  it("handles an empty batch without divide-by-zero output", () => {
    const evaluation = evaluateSignalQualityBatch([]);

    expect(evaluation).toMatchObject({
      averageScore: 0,
      passCount: 0,
      sampleSize: 0,
    });
  });

  it("passes the default deterministic fixture set", () => {
    const evaluation = evaluateDefaultSignalQualityFixtures();

    expect(evaluation.sampleSize).toBe(signalQualityFixtures.length);
    expect(evaluation.passCount).toBe(signalQualityFixtures.length);
    expect(evaluation.averageScore).toBeGreaterThanOrEqual(4);
  });
});
