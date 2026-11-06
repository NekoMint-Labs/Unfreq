export function contentSourceLabel(source: unknown, legacySource?: string): string {
  if (source === "human") return "用户发起";
  if (source === "ai_generated") return "系统 AI 生成";
  if (source === "seed" || legacySource === "SEEDED") return "演示样本";
  return "来源未标注";
}
