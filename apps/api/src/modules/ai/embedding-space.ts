import { createHash } from "node:crypto";

export const signalEmbeddingTemplateVersion = "signal-body-v1";
// pgvector cosine distance; provider output is stored without local rescaling.
export const embeddingNormalization = "provider-output-cosine-v1";

export type EmbeddingSpaceConfig = { provider: string; model: string; dimensions: number; version: string };

export function embeddingSpaceKey(config: EmbeddingSpaceConfig, templateVersion = signalEmbeddingTemplateVersion): string {
  const descriptor = [config.provider, config.model, config.dimensions, embeddingNormalization, templateVersion, config.version];
  return `es1:${createHash("sha256").update(JSON.stringify(descriptor)).digest("hex")}`;
}

export function isEmbeddingSpaceKey(value: string): boolean {
  return /^es1:[a-f0-9]{64}$/u.test(value);
}

export function signalEmbeddingText(expandedText: string): string {
  return `正文：${expandedText.replace(/\r\n?/gu, "\n").trim()}`;
}
