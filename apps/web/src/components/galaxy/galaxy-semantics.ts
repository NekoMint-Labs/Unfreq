import type { GalaxySignalPoint } from "@unfreq/contracts";

export const galaxyLegendItems = [
  { label: "星点", text: "可点开的星点代表一条公开表达，背景星尘和远星仅作装饰。" },
  { label: "位置与距离", text: "位置是艺术化排布，画面远近不表示文字的语义相似程度。" },
  { label: "连线", text: "连线来自当前样本中的规则关联，经过显示预算和视觉筛选，不代表真实人际关系。" },
  { label: "颜色、亮度与大小", text: "颜色区分公开主频段，本人信号另作标记。亮度和大小还受共振、景深和闪烁等影响，不是相似度或排名。" },
] as const;

export const galaxyAssociationMethod = "候选来自既有频率资料规则；候选数不等于画面连线数，部分点线会因显示预算和视觉筛选而隐藏。";
export const galaxyAssociationDistance = "图上远近不表示语义相似度，连线也不代表真实人际关系。";

/** Explain only records in the same public response; never fetch missing IDs. */
export function getGalaxyAssociationInfo(point: GalaxySignalPoint, sample: readonly GalaxySignalPoint[]) {
  const byId = new Map(sample.map((item) => [item.id, item]));
  const related = new Set<string>();
  const current = byId.get(point.id);
  if (current) {
    for (const id of current.matchIds) if (id !== point.id && byId.has(id)) related.add(id);
    for (const other of byId.values()) if (other.id !== point.id && other.matchIds.includes(point.id)) related.add(other.id);
  }
  const candidateCount = related.size;
  return { candidateCount, text: candidateCount === 0
    ? "当前返回样本未列出与本条相关的规则候选。"
    : `当前返回样本中，${candidateCount} 条表达与本条存在规则候选记录。` };
}
