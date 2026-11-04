export type RerankerAdapterCandidate = {
  expandedText: string;
  id: string;
};

export type RerankerAdapterResult = {
  id: string;
  reason: string;
  score: number;
};

type GenericRerankerPayload = {
  results?: Array<{
    id?: unknown;
    reason?: unknown;
    score?: unknown;
  }>;
};

type SiliconFlowRerankerPayload = {
  results?: Array<{
    index?: unknown;
    relevance_score?: unknown;
  }>;
};

function isSiliconFlowProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === "siliconflow";
}

export function buildRerankerRequestBody(params: {
  candidates: RerankerAdapterCandidate[];
  model: string;
  provider: string;
  queryText: string;
}): Record<string, unknown> {
  if (isSiliconFlowProvider(params.provider)) {
    return {
      documents: params.candidates.map((candidate) => candidate.expandedText),
      top_n: params.candidates.length,
      return_documents: false,
      model: params.model,
      query: params.queryText,
    };
  }

  return {
    candidates: params.candidates,
    model: params.model,
    query: params.queryText,
  };
}

function readGenericRerankerResults(
  payload: unknown,
): NonNullable<GenericRerankerPayload["results"]> {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const results = (payload as GenericRerankerPayload).results;

  return Array.isArray(results) ? results : [];
}

function readSiliconFlowRerankerResults(
  payload: unknown,
): NonNullable<SiliconFlowRerankerPayload["results"]> {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const results = (payload as SiliconFlowRerankerPayload).results;

  return Array.isArray(results) ? results : [];
}

function parseGenericRerankerPayload(
  payload: unknown,
  candidateIds: Set<string>,
): RerankerAdapterResult[] {
  const results = readGenericRerankerResults(payload);

  return results.flatMap((item) => {
    if (
      typeof item.id !== "string" ||
      !candidateIds.has(item.id) ||
      typeof item.score !== "number" ||
      !Number.isFinite(item.score)
    ) {
      return [];
    }

    return {
      id: item.id,
      reason: typeof item.reason === "string" ? item.reason : "reranker",
      score: item.score,
    };
  });
}

function parseSiliconFlowRerankerPayload(
  payload: unknown,
  candidates: RerankerAdapterCandidate[],
): RerankerAdapterResult[] {
  const results = readSiliconFlowRerankerResults(payload);

  return results.flatMap((item) => {
    if (
      typeof item.index !== "number" ||
      !Number.isInteger(item.index) ||
      item.index < 0 ||
      item.index >= candidates.length ||
      typeof item.relevance_score !== "number" ||
      !Number.isFinite(item.relevance_score)
    ) {
      return [];
    }

    return {
      id: candidates[item.index].id,
      reason: "reranker",
      score: item.relevance_score,
    };
  });
}

export function parseRerankerResponsePayload(params: {
  candidates: RerankerAdapterCandidate[];
  payload: unknown;
  provider: string;
  scoreScale?: unknown;
}): RerankerAdapterResult[] {
  const raw = readGenericRerankerResults(params.payload);
  if (raw.length !== params.candidates.length) return [];
  const results = isSiliconFlowProvider(params.provider)
    ? parseSiliconFlowRerankerPayload(params.payload, params.candidates)
    : parseGenericRerankerPayload(
    params.payload,
    new Set(params.candidates.map((candidate) => candidate.id)),
  );
  if (results.length !== params.candidates.length || new Set(results.map((item) => item.id)).size !== results.length) return [];
  const normalized = results.map((item) => ({ ...item, score: normalizeRerankerScore(item.score, params.scoreScale ?? "zero_to_one") }));
  if (normalized.some((item) => item.score === undefined)) return [];
  return normalized.map((item) => ({ ...item, score: item.score! }));
}

/** An explicitly declared relevance range; never infer it from observed values. */
export function normalizeRerankerScore(value: unknown, scale: unknown): number | undefined {
  if (scale !== "zero_to_one" && scale !== "zero_to_hundred") return undefined;
  const maximum = scale === "zero_to_one" ? 1 : 100;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value / maximum : undefined;
}
