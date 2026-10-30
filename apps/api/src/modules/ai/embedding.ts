import { env } from "../../config/env.js";
import { embeddingSpaceKey, signalEmbeddingTemplateVersion } from "./embedding-space.js";
import { safeProviderAccounting, type AiExecutionMetadata } from "./provider-execution.js";
import { AppError } from "../../shared/errors.js";
import {
  assertGenerationActive,
  beforeGenerationDispatch,
  combineGenerationAbortSignal,
  throwIfGenerationStopped,
  waitForGenerationRetry,
} from "../../shared/generation-execution.js";
import {
  resolveEmbeddingProviderConfig,
  resolveEmbeddingProviderConfigs,
} from "./provider-config.js";

export const signalEmbeddingDimensions = env.embeddingDimensions;

const embeddingTimeoutMs = 5_000;
const embeddingMaxRetries = 3;
const defaultRetryDelayMs = 100;

type EmbeddingPayload = {
  data?: Array<{
    embedding?: unknown;
  }>;
  output?: {
    embeddings?: Array<{
      embedding?: unknown;
    }>;
  };
};

export type EmbeddingProviderConfig = {
  apiKey: string;
  baseUrl: string;
  dimensions: number;
  model: string;
  provider: string;
  version: string;
};

export type EmbeddingResult = {
  execution?: AiExecutionMetadata;
  dimensions: number;
  embedding: number[];
  model: string;
  provider: string;
  version: string;
};

export type EmbeddingLogger = {
  error: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

type GenerateEmbeddingOptions = {
  configs?: EmbeddingProviderConfig[];
  templateVersion?: string;
  purpose?: "creation" | "public-detail" | "backfill";
  config?: EmbeddingProviderConfig;
  logger?: EmbeddingLogger;
  retryDelayMs?: number;
  timeoutMs?: number;
};

async function getEmbeddingConfig(): Promise<EmbeddingProviderConfig> {
  return resolveEmbeddingProviderConfig();
}

async function getEmbeddingConfigs(): Promise<EmbeddingProviderConfig[]> {
  return resolveEmbeddingProviderConfigs();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function toErrorReason(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

function extractEmbedding(payload: EmbeddingPayload): unknown {
  return payload.data?.[0]?.embedding ?? payload.output?.embeddings?.[0]?.embedding;
}

export function validateEmbeddingVector(
  value: unknown,
  dimensions = signalEmbeddingDimensions,
): number[] {
  if (!Array.isArray(value) || value.length !== dimensions) {
    throw new AppError("AI_UNAVAILABLE", "Embedding provider returned an invalid vector.");
  }

  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new AppError("AI_UNAVAILABLE", "Embedding provider returned an invalid vector.");
  }

  if (value.every((item) => item === 0)) {
    throw new AppError("AI_UNAVAILABLE", "Embedding provider returned a zero vector.");
  }

  return value;
}

export async function isEmbeddingProviderConfigured(
  config?: EmbeddingProviderConfig,
): Promise<boolean> {
  await assertGenerationActive();
  const resolvedConfig = config ?? (await getEmbeddingConfig());
  await assertGenerationActive();

  return resolvedConfig.apiKey.length > 0 && resolvedConfig.baseUrl.length > 0;
}

async function requestEmbedding(params: {
  config: EmbeddingProviderConfig;
  signal: AbortSignal;
  text: string;
}): Promise<{ embedding: unknown; accounting: ReturnType<typeof safeProviderAccounting> }> {
  const response = await fetch(`${normalizeBaseUrl(params.config.baseUrl)}/embeddings`, {
    body: JSON.stringify({
      dimensions: params.config.dimensions,
      encoding_format: "float",
      input: [params.text],
      model: params.config.model,
    }),
    headers: {
      authorization: `Bearer ${params.config.apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: params.signal,
  });
  await assertGenerationActive();

  if (!response.ok) {
    throw new AppError("AI_UNAVAILABLE", "Embedding provider unavailable.", {
      statusCode: response.status,
    });
  }

  const payload = (await response.json()) as EmbeddingPayload;
  await assertGenerationActive();

  return { embedding: extractEmbedding(payload),
    accounting: safeProviderAccounting(payload) };
}

export async function generateEmbedding(
  text: string,
  options: GenerateEmbeddingOptions = {},
): Promise<EmbeddingResult> {
  await assertGenerationActive();
  const startedAt = Date.now();
  const execution: AiExecutionMetadata = { schemaVersion: 1, taskType: "embedding", source: "unavailable",
    provider: "unavailable", model: "unavailable", promptVersion: "not-applicable",
    inputTemplateVersion: options.templateVersion ?? signalEmbeddingTemplateVersion,
    attempts: [], durationMs: 0, cost: "unknown" };
  const compactText = text.trim();
  const configs = options.configs ?? (options.config === undefined ? await getEmbeddingConfigs() : [options.config]);
  await assertGenerationActive();
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const timeoutMs = options.timeoutMs ?? embeddingTimeoutMs;
  const maxAttempts = embeddingMaxRetries + 1;

  if (compactText.length === 0) {
    throw new AppError("AI_UNAVAILABLE", "Embedding input is empty.");
  }

  let lastError: unknown;

  for (const [configIndex, config] of configs.entries()) {
    await assertGenerationActive();
    if (!(await isEmbeddingProviderConfigured(config))) {
      lastError = new AppError("AI_UNAVAILABLE", "Embedding provider is not configured.");
      continue;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await assertGenerationActive();
      const attemptStartedAt = Date.now();
      let dispatched = false;
      let accounting: ReturnType<typeof safeProviderAccounting> = {};
      let timeout: NodeJS.Timeout | undefined;
      let combined: ReturnType<typeof combineGenerationAbortSignal> | undefined;
      let shouldRetry = false;

      try {
        options.logger?.info(
          {
            action: "embedding.generate",
            attempt,
            configIndex,
            dimensions: config.dimensions,
            model: config.model,
            provider: config.provider,
            version: config.version,
          },
          "embedding generation started",
        );

        await authorizeProviderDispatch("embedding");
        await beforeGenerationDispatch("embedding", "embedding");
        const controller = new AbortController();
        combined = combineGenerationAbortSignal(controller.signal);
        timeout = setTimeout(() => { controller.abort(); }, timeoutMs);
        throwIfGenerationStopped();
        dispatched = true;
        const result = await requestEmbedding({
          config,
          signal: combined.signal,
          text: compactText,
        });
        accounting = result.accounting;
        const embedding = validateEmbeddingVector(result.embedding, config.dimensions);
        await assertGenerationActive();

        const actualModel = accounting.responseModel ?? config.model;
        const version = embeddingSpaceKey({ ...config, model: actualModel }, options.templateVersion ?? signalEmbeddingTemplateVersion);
        execution.attempts.push({ provider: config.provider, model: config.model, profile: "default",
          outcome: "SUCCEEDED", durationMs: Date.now() - attemptStartedAt, ...accounting });
        Object.assign(execution, { source: "provider", provider: config.provider, model: actualModel, durationMs: Date.now() - startedAt });

        options.logger?.info(
          {
            action: "embedding.generate",
            purpose: options.purpose ?? "creation",
            persisted: false,
            cost: "unknown",
            inputCharacters: compactText.length,
            ...accounting,
            execution,
            attempts: attempt,
            configIndex,
            dimensions: config.dimensions,
            durationMs: Date.now() - attemptStartedAt,
            model: config.model,
            provider: config.provider,
            version,
          },
          "embedding generation completed",
        );
        await assertGenerationActive();

        return {
          execution,
          dimensions: config.dimensions,
          embedding,
          model: actualModel,
          provider: config.provider,
          version,
        };
      } catch (error) {
        throwIfGenerationStopped(error);
        await assertGenerationActive();
        lastError = error;
        if (dispatched) execution.attempts.push({ provider: config.provider, model: config.model, profile: "default",
          outcome: "FAILED", durationMs: Date.now() - attemptStartedAt, failureKind: toErrorReason(error), ...accounting });

        const fields = {
          action: "embedding.generate",
          purpose: options.purpose ?? "creation",
          cost: "unknown",
          inputCharacters: compactText.length,
          ...accounting,
          attempt,
          configIndex,
          durationMs: Date.now() - attemptStartedAt,
          dimensions: config.dimensions,
          maxAttempts,
          model: config.model,
          provider: config.provider,
          reason: toErrorReason(error),
          version: config.version,
        };

        if (attempt < maxAttempts) {
          options.logger?.warn(fields, "embedding generation retrying");
          shouldRetry = true;
        } else {
          options.logger?.error(fields, "embedding generation failed");
        }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        combined?.dispose();
      }
      if (shouldRetry) await waitForGenerationRetry(retryDelayMs);
    }
  }

  await assertGenerationActive();
  if (lastError instanceof AppError) {
    execution.durationMs = Date.now() - startedAt;
    throw new AppError(lastError.code, lastError.message, { execution });
  }

  throw new AppError("AI_UNAVAILABLE", "Embedding provider unavailable.");
}
import { authorizeProviderDispatch } from "../../shared/abuse-control.js";
