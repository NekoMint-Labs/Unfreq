import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MonthlyRecap, MySignalSummary, SignalFingerprint, SignalInterpretation } from "@unfreq/contracts";
import { SignalFingerprintPanel } from "./SignalFingerprintPanel";
import { FrequencyBandSummary } from "../my-frequency/FrequencyBandSummary";
import { MonthlyRecapEntry, MonthlyRecapSourceNote } from "../my-frequency/MonthlyRecapEntry";
import { getTopFrequencyProfiles } from "../my-frequency/my-frequency-utils";
import { canDisplaySignalInterpretation } from "../../lib/signal-interpretation";

const fingerprint: SignalFingerprint = {
  title: "孤独的夜里想被理解", frequency: "SIG-SYNTHETIC", primaryBand: "self_mirror",
  subFeeling: "self_doubt", displayText: "自我镜像 · 自我怀疑", primaryEmotion: "自我怀疑",
  coreNeed: "固定心理需求不应显示", hiddenNeed: "隐藏需求不应显示", innerConflict: "固定冲突不应显示",
  narrativeConflict: "另一冲突不应显示", energy: 0.82, openness: 0.63, emotionTone: "压抑",
  resonanceKeywords: ["被理解"], riskLevel: "LOW", secondaryEmotions: [], signalType: "self_mirror",
  tags: ["自我怀疑"], theme: "自我镜像",
};
const states: Array<SignalInterpretation | undefined> = [
  undefined,
  { version: 1, state: "unknown", source: "unknown" },
  { version: 1, state: "unknown", source: "rules" },
  { version: 1, state: "unverified", source: "provider" },
];

describe("unvalidated psychological interpretation is not displayed", () => {
  it.each(states)("shows a neutral status without inferred titles or analysis for %j", (interpretation) => {
    expect(canDisplaySignalInterpretation(interpretation)).toBe(false);
    const markup = renderToStaticMarkup(createElement(SignalFingerprintPanel, {
      fingerprint: { ...fingerprint, interpretation },
    }));
    expect(markup).toContain("解读状态");
    expect(markup).not.toContain(fingerprint.title);
    expect(markup).toContain(fingerprint.frequency);
    expect(markup).toContain("暂不展示心理解读");
    for (const text of [fingerprint.displayText, fingerprint.coreNeed, fingerprint.innerConflict,
      fingerprint.emotionTone, "82%", "63%", "自我怀疑", "被理解", "主频段", "开放度"]) {
      expect(markup).not.toContain(text);
    }
  });

  it("excludes mixed legacy, rules, and unverified Provider profiles from personal summaries", () => {
    const signals: MySignalSummary[] = states.map((interpretation, index) => ({
      id: `synthetic-${index}`, createdAt: "2026-11-01T00:00:00Z", status: "DRAFT",
      expandedText: "合成正文应保留在表达中", seedText: fingerprint.title, resonanceCount: index,
      frequencyProfile: { ...fingerprint, interpretation },
    }));
    const before = JSON.stringify(signals);
    expect(getTopFrequencyProfiles(signals)).toEqual([]);
    expect(renderToStaticMarkup(createElement(FrequencyBandSummary, { signals }))).toBe("");
    expect(JSON.stringify(signals)).toBe(before);
  });

  it("marks saved recaps as automatic and unverified while preserving their text", () => {
    const recap: MonthlyRecap = { id: "synthetic-recap", frequencyId: "synthetic-frequency", yearMonth: "2026-10",
      createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", generatedAt: "2026-11-01T00:00:00Z",
      signalCount: 3, totalResonanceCount: 2, summary: "这是保留原样的历史回顾正文。", themeWords: ["历史主题词"] };
    const before = JSON.stringify(recap);
    const markup = renderToStaticMarkup(createElement(MonthlyRecapEntry, { recap }));
    expect(markup).toContain(recap.summary);
    expect(markup).toContain(recap.themeWords[0]);
    expect(markup).toContain("自动整理的回顾，可能有误，请对照原文。");
    expect(markup).not.toContain("真实回顾");
    expect(markup).not.toContain("实际模型生成");
    expect(JSON.stringify(recap)).toBe(before);
    // The detail page renders the same note beside its saved summary.
    expect(renderToStaticMarkup(createElement(MonthlyRecapSourceNote))).toContain("自动整理的回顾，可能有误，请对照原文。");
  });

  it("does not promise a verified recap before any has been generated", () => {
    const markup = renderToStaticMarkup(createElement(MonthlyRecapEntry));
    expect(markup).toContain("至少需要 3 条");
    expect(markup).not.toContain("真实回顾");
  });
});
