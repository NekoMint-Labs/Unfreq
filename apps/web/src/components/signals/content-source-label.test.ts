import { describe, expect, it } from "vitest";
import { contentSourceLabel } from "./content-source-label";
describe("content provenance wording", () => {
  it("distinguishes user initiation from system generation and demo content", () => {
    expect(contentSourceLabel("human")).toBe("用户发起");
    expect(contentSourceLabel("ai_generated")).toBe("系统 AI 生成");
    expect(contentSourceLabel("seed")).toBe("演示样本");
    expect(contentSourceLabel("human")).not.toContain("纯人工");
  });
  it("does not infer human authorship from publication status or unknown input", () => {
    for (const source of [undefined, "PUBLISHED", "unknown", "__proto__", null]) expect(contentSourceLabel(source, "PUBLISHED")).toBe("来源未标注");
    expect(contentSourceLabel(undefined, "SEEDED")).toBe("演示样本");
  });
});
