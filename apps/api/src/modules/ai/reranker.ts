import { AppError } from "../../shared/errors.js";
import {
  assertGenerationActive,
  beforeGenerationDispatch,
  combineGenerationAbortSignal,
  throwIfGenerationStopped,
} from "../../shared/generation-execution.js";
import {
  resolveRerankerProviderConfigs,
  type RerankerProviderConfig,
} from "./provider-config.js";
import { buildRerankerRequestBody, isRerankerScoreScale, parseRerankerResponsePayload, rerankerScoreVersion, type RerankerAdapterResult } from "./reranker-adapter.js";
import { safeProviderAccounting, type AiExecutionMetadata } from "./provider-execution.js";
import type { EmbeddingLogger } from "./embedding.js";

const rerankerTimeoutMs = 5_000;

export type RerankCandidateInput = {
  distance?: number;
  expandedText: string;
  id: string;
};

export type RerankInput = {
  candidates: RerankCandidateInput[];
  queryText: string;
};

export type RerankCandidateResult = RerankerAdapterResult;

export type RerankResult = {
  scoreScale: "zero_to_one";
  execution?: AiExecutionMetadata;
  model: string;
  provider: string;
  results: RerankCandidateResult[];
};

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
  const configs = config === undefined ? await getRerankerConfigs() : [config];
  await assertGenerationActive();

  return configs.some((resolvedConfig) => (
    isRerankerScoreScale(resolvedConfig.scoreScale) &&
    resolvedConfig.provider !== "disabled" &&
    resolvedConfig.apiKey.length > 0 &&
    resolvedConfig.baseUrl.length > 0
  ));
}

function accountingForRerank(payload: unknown): ReturnType<typeof safeProviderAccounting> {
  const base = safeProviderAccounting(payload);
  if (typeof payload !== "object" || payload === null) return base;
  const record = payload as { tokens?: unknown; meta?: { tokens?: unknown } };
  const usage = safeProviderAccounting({ usage: record.tokens ?? record.meta?.tokens }).usage;
  return { ...base, ...(usage === undefined && base.usage === undefined ? {} : { usage: { ...usage, ...base.usage } }) };
}

export async function rerankCandidates(
  input: RerankInput,
  config?: RerankerProviderConfig,
  options: { logger?: EmbeddingLogger } = {},
): Promise<RerankResult> {
  await assertGenerationActive();
  const startedAt = Date.now();
  const execution: AiExecutionMetadata = { schemaVersion: 1, taskType: "rerank", source: "unavailable", provider: "unavailable", model: "unavailable",
    inputTemplateVersion: "rerank-query-candidates-v1", promptVersion: "not-applicable", attempts: [], durationMs: 0, cost: "unknown" };
  const configs = config === undefined ? await getRerankerConfigs() : [config];
  await assertGenerationActive();

  if (input.candidates.length === 0) {
    const [resolvedConfig] = configs;

    return {
      scoreScale: "zero_to_one",
      execution,
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
    const attemptStartedAt = Date.now();
    const priorAttemptCount = execution.attempts.length;
    let dispatched = false;
    let accounting: ReturnType<typeof safeProviderAccounting> = {};

    try {
      await authorizeProviderDispatch("reranker");
      await beforeGenerationDispatch("reranker", "rerank");
      const controller = new AbortController();
      combined = combineGenerationAbortSignal(controller.signal);
      timeout = setTimeout(() => { controller.abort(); }, rerankerTimeoutMs);
      throwIfGenerationStopped();
      dispatched = true;
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
          kind: "http_error",
        });
      }

      const payload: unknown = await response.json();
      accounting = accountingForRerank(payload);
      await assertGenerationActive();
      const results = parseRerankerResponsePayload({
        candidates: input.candidates,
        payload,
        provider: resolvedConfig.provider,
        scoreScale: resolvedConfig.scoreScale,
      });

      if (results.length !== input.candidates.length) {
        throw new AppError("AI_UNAVAILABLE", "Reranker provider returned incomplete or invalid scores.", { kind: "invalid_score_batch" });
      }
      await assertGenerationActive();

      execution.attempts.push({ provider: resolvedConfig.provider, model: resolvedConfig.model, profile: "default",
        outcome: "SUCCEEDED", durationMs: Date.now() - attemptStartedAt, ...accounting });
      const model = accounting.responseModel ?? resolvedConfig.model;
      Object.assign(execution, { source: "provider", provider: resolvedConfig.provider, model, durationMs: Date.now() - startedAt });
      options.logger?.info({ action: "rerank.generate", execution, scoreScale: resolvedConfig.scoreScale, scoreVersion: rerankerScoreVersion,
        candidateCount: input.candidates.length, inputCharacters: input.queryText.length + input.candidates.reduce((n, item) => n + item.expandedText.length, 0) }, "rerank completed");
      return {
        scoreScale: "zero_to_one",
        execution,
        model,
        provider: resolvedConfig.provider,
        results,
      };
    } catch (error) {
      throwIfGenerationStopped(error);
      await assertGenerationActive();
      lastError = error;
      const details = error instanceof AppError ? error.details as { kind?: string; statusCode?: number } | undefined : undefined;
      if (dispatched) execution.attempts.push({ provider: resolvedConfig.provider, model: resolvedConfig.model, profile: "default",
        outcome: "FAILED", durationMs: Date.now() - attemptStartedAt, ...accounting,
        failureKind: details?.kind ?? (error instanceof Error && error.name === "AbortError" ? "timeout" : "invalid_response_or_network"),
        ...(details?.statusCode === undefined ? {} : { statusCode: details.statusCode }) });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      combined?.dispose();
      if (dispatched) options.logger?.info({ action: "rerank.attempt", provider: resolvedConfig.provider,
        model: resolvedConfig.model, scoreScale: resolvedConfig.scoreScale, candidateCount: input.candidates.length,
        durationMs: Date.now() - attemptStartedAt, cost: "unknown", ...accounting,
        outcome: execution.attempts.length > priorAttemptCount ? execution.attempts.at(-1)!.outcome : "STOPPED_OR_UNACKNOWLEDGED",
      }, "rerank dispatch accounting; missing usage does not imply zero cost");
    }
  }

  await assertGenerationActive();
  execution.durationMs = Date.now() - startedAt;
  options.logger?.warn({ action: "rerank.generate", execution, candidateCount: input.candidates.length }, "rerank failed; no provider batch accepted");
  if (lastError instanceof AppError) {
    throw new AppError(lastError.code, lastError.message, { execution });
  }

  throw new AppError("AI_UNAVAILABLE", "Reranker provider unavailable.", { execution });
}
import { authorizeProviderDispatch } from "../../shared/abuse-control.js";
