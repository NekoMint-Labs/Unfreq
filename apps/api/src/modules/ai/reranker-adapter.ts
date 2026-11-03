import type { RerankerScoreScale } from "@unfreq/contracts/admin";

export const rerankerScoreVersion = "relevance-range-v1";
export type RerankerAdapterCandidate = { expandedText: string; id: string };
export type RerankerAdapterResult = {
  id: string;
  reason: string;
  rawScore: number;
  rawScale: RerankerScoreScale;
  /** Common relevance scale [0,1], higher is better, not a probability. */
  score: number;
};
export function isRerankerScoreScale(value: unknown): value is RerankerScoreScale {
  return value === "zero_to_one" || value === "zero_to_hundred";
}
export function normalizeRerankerScore(value: unknown, scale: unknown): number | undefined {
  if (!isRerankerScoreScale(scale) || typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const maximum = scale === "zero_to_one" ? 1 : 100;
  if (value < 0 || value > maximum) return undefined;
  return value / maximum;
}
function isSiliconFlowProvider(provider: string): boolean { return provider.trim().toLowerCase() === "siliconflow"; }
export function buildRerankerRequestBody(params: {
  candidates: RerankerAdapterCandidate[]; model: string; provider: string; queryText: string;
}): Record<string, unknown> {
  if (isSiliconFlowProvider(params.provider)) return {
    documents: params.candidates.map((candidate) => candidate.expandedText), model: params.model,
    query: params.queryText, top_n: params.candidates.length, return_documents: false,
  };
  return { candidates: params.candidates, model: params.model, query: params.queryText };
}

// A batch is atomic: duplicate/unknown IDs, partial coverage, non-finite or
// out-of-contract scores invalidate the whole provider response. Never fill a
// hole with a number from another score distribution.
export function parseRerankerResponsePayload(params: {
  candidates: RerankerAdapterCandidate[]; payload: unknown; provider: string; scoreScale?: unknown;
}): RerankerAdapterResult[] {
  if (!isRerankerScoreScale(params.scoreScale) || typeof params.payload !== "object" || params.payload === null) return [];
  const values = (params.payload as { results?: unknown }).results;
  if (!Array.isArray(values) || values.length !== params.candidates.length || values.length === 0) return [];
  const candidates = new Set(params.candidates.map((item) => item.id));
  if (candidates.size !== params.candidates.length) return [];
  const seen = new Set<string>();
  const results: RerankerAdapterResult[] = [];
  for (const raw of values) {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const siliconFlow = isSiliconFlowProvider(params.provider);
    const index = item.index;
    const id = siliconFlow
      ? typeof index === "number" && Number.isInteger(index) && index >= 0 && index < params.candidates.length ? params.candidates[index].id : undefined
      : item.id;
    const rawScore = siliconFlow ? item.relevance_score : item.score;
    const score = normalizeRerankerScore(rawScore, params.scoreScale);
    if (typeof id !== "string" || !candidates.has(id) || seen.has(id) || score === undefined) return [];
    seen.add(id);
    results.push({ id, reason: "provider_relevance", rawScore: rawScore as number, rawScale: params.scoreScale, score });
  }
  return results;
}
