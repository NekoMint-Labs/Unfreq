import { AppError } from "../../shared/errors.js";
import {
  assertGenerationActive,
  beforeGenerationDispatch,
  combineGenerationAbortSignal,
  throwIfGenerationStopped,
} from "../../shared/generation-execution.js";
import {
  resolveRerankerProviderConfig,
  resolveRerankerProviderConfigs,
  type RerankerProviderConfig,
} from "./provider-config.js";
import { buildRerankerRequestBody, parseRerankerResponsePayload } from "./reranker-adapter.js";

const rerankerTimeoutMs = 5_000;

export type RerankCandidateInput = {
  distance: number;
  expandedText: string;
  id: string;
};

export type RerankInput = {
  candidates: RerankCandidateInput[];
  queryText: string;
};

export type RerankCandidateResult = {
  id: string;
  reason: string;
  score: number;
};

export type RerankResult = {
  model: string;
  provider: string;
  results: RerankCandidateResult[];
};

async function getRerankerConfig(): Promise<RerankerProviderConfig> {
  return resolveRerankerProviderConfig();
}

async function getRerankerConfigs(): Promise<RerankerProviderConfig[]> {
  return resolveRerankerProviderConfigs();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export async function isRerankerProviderConfigured(
  config?: RerankerProviderConfig,
): Promise<boolean> {
  await assertGenerationActive();
  const resolvedConfig = config ?? (await getRerankerConfig());
  await assertGenerationActive();

  return (
    resolvedConfig.provider !== "disabled" &&
    resolvedConfig.apiKey.length > 0 &&
    resolvedConfig.baseUrl.length > 0
  );
}

export async function rerankCandidates(
  input: RerankInput,
  config?: RerankerProviderConfig,
): Promise<RerankResult> {
  await assertGenerationActive();
  const configs = config === undefined ? await getRerankerConfigs() : [config];
  await assertGenerationActive();

  if (input.candidates.length === 0) {
    const [resolvedConfig] = configs;

    return {
      model: resolvedConfig?.model ?? "local-disabled",
      provider: resolvedConfig?.provider ?? "disabled",
      results: [],
    };
  }

  let lastError: unknown;

  for (const resolvedConfig of configs) {
    await assertGenerationActive();
    if (!(await isRerankerProviderConfigured(resolvedConfig))) {
      lastError = new AppError("AI_UNAVAILABLE", "Reranker provider is not configured.");
      continue;
    }

    let timeout: NodeJS.Timeout | undefined;
    let combined: ReturnType<typeof combineGenerationAbortSignal> | undefined;

    try {
      await authorizeProviderDispatch("reranker");
      await beforeGenerationDispatch("reranker", "rerank");
      const controller = new AbortController();
      combined = combineGenerationAbortSignal(controller.signal);
      timeout = setTimeout(() => { controller.abort(); }, rerankerTimeoutMs);
      throwIfGenerationStopped();
      const response = await fetch(`${normalizeBaseUrl(resolvedConfig.baseUrl)}/rerank`, {
        body: JSON.stringify(
          buildRerankerRequestBody({
            candidates: input.candidates,
            model: resolvedConfig.model,
            provider: resolvedConfig.provider,
            queryText: input.queryText,
          }),
        ),
        headers: {
          authorization: `Bearer ${resolvedConfig.apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: combined.signal,
      });
      await assertGenerationActive();

      if (!response.ok) {
        throw new AppError("AI_UNAVAILABLE", "Reranker provider unavailable.", {
          statusCode: response.status,
        });
      }

      const payload: unknown = await response.json();
      await assertGenerationActive();
      const results = parseRerankerResponsePayload({
        candidates: input.candidates,
        payload,
        provider: resolvedConfig.provider,
      });

      if (results.length === 0) {
        throw new AppError("AI_UNAVAILABLE", "Reranker provider returned no usable scores.");
      }
      await assertGenerationActive();

      return {
        model: resolvedConfig.model,
        provider: resolvedConfig.provider,
        results,
      };
    } catch (error) {
      throwIfGenerationStopped(error);
      await assertGenerationActive();
      lastError = error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      combined?.dispose();
    }
  }

  await assertGenerationActive();
  if (lastError instanceof AppError) {
    throw lastError;
  }

  throw new AppError("AI_UNAVAILABLE", "Reranker provider unavailable.");
}
import { authorizeProviderDispatch } from "../../shared/abuse-control.js";
