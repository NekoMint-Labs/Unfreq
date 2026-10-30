import { describe, expect, it } from "vitest";
import type { GalaxySignalPoint } from "@unfreq/contracts";
import { getGalaxyAssociationInfo } from "./galaxy-semantics";

const point = (id: string, matchIds: string[] = []): GalaxySignalPoint => ({
  id, matchIds, expandedText: "合成公开表达", tags: [], publicationVersion: 1,
  createdAt: "2026-10-30T00:00:00Z", position: { x: 0, y: 0, z: 0 },
  source: "human", isMine: false, resonanceCount: 0,
});

describe("public Galaxy association explanation", () => {
  it("counts only distinct existing public candidates, excluding self and missing IDs", () => {
    const a = point("a", ["a", "b", "b", "c", "missing-private"]);
    const info = getGalaxyAssociationInfo(a, [a, point("b"), point("c")]);
    expect(info.candidateCount).toBe(2);
    expect(info.text).not.toContain("missing-private");
  });
  it("accounts for incoming-only links instead of falsely reporting no association", () => {
    const a = point("a"); const b = point("b", ["a"]);
    expect(getGalaxyAssociationInfo(a, [a, b, b]).candidateCount).toBe(1);
  });
  it("counts a mutual pair once and does not infer association from geometric proximity", () => {
    const a = point("a", ["b"]); const b = point("b", ["a"]);
    expect(getGalaxyAssociationInfo(a, [a, b, point("unlinked-at-same-position")]).candidateCount).toBe(1);
  });
  it("does not describe a stale point's candidate IDs as current public associations", () => {
    expect(getGalaxyAssociationInfo(point("old", ["b"]), [point("b")])).toEqual({
      candidateCount: 0, text: "当前返回样本未列出与本条相关的规则候选。",
    });
    expect(getGalaxyAssociationInfo(point("a", ["b"]), [point("a"), point("b")]).candidateCount).toBe(0);
  });
});
