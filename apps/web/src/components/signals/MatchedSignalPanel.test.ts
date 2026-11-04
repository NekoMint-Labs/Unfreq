import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchedSignalPanel } from "./MatchedSignalPanel";
import type { PublicSignalMatchSummary } from "@unfreq/contracts";

const match: PublicSignalMatchSummary = { id: "synthetic", score: 94, source: "PUBLISHED", resonanceCount: 0,
  publicationVersion: 1, expandedText: "Synthetic confirmed expression", tags: [] };
describe("matching explanations", () => {
  it.each([["human", "用户发起"], ["ai_generated", "系统 AI 生成"], ["seed", "演示样本"], [undefined, "来源未标注"]] as const)("labels %s from explicit source metadata without displaying a confidence score", (source, label) => {
    const html = renderToStaticMarkup(createElement(MatchedSignalPanel, { matches: [{ ...match, contentSource: source }] }));
    expect(html).toContain(label);
    expect(html).not.toContain("94");
    expect(html).toContain("不代表相似概率");
  });
  it("keeps empty matching empty instead of manufacturing example cards", () => {
    const html = renderToStaticMarkup(createElement(MatchedSignalPanel, { matches: [] }));
    expect(html).toContain("暂无合适同频");
    expect(html).not.toContain("<article");
  });
});
