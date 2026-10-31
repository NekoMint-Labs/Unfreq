import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MySignalSummary, SignalFingerprint, SignalInterpretation } from "@unfreq/contracts";
import { SignalFingerprintPanel } from "./SignalFingerprintPanel";
import { FrequencyBandSummary } from "../my-frequency/FrequencyBandSummary";
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
});
