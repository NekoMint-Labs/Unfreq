import { env } from "../../config/env.js";
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
}): Promise<number[]> {
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

  return validateEmbeddingVector(extractEmbedding(payload), params.config.dimensions);
}

export async function generateEmbedding(
  text: string,
  options: GenerateEmbeddingOptions = {},
): Promise<EmbeddingResult> {
  await assertGenerationActive();
  const compactText = text.trim();
  const configs = options.config === undefined ? await getEmbeddingConfigs() : [options.config];
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
      const startedAt = Date.now();
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

        await beforeGenerationDispatch("embedding", "embedding");
        const controller = new AbortController();
        combined = combineGenerationAbortSignal(controller.signal);
        timeout = setTimeout(() => { controller.abort(); }, timeoutMs);
        throwIfGenerationStopped();
        const embedding = await requestEmbedding({
          config,
          signal: combined.signal,
          text: compactText,
        });
        await assertGenerationActive();

        options.logger?.info(
          {
            action: "embedding.generate",
            attempts: attempt,
            configIndex,
            dimensions: config.dimensions,
            durationMs: Date.now() - startedAt,
            model: config.model,
            provider: config.provider,
            version: config.version,
          },
          "embedding generation completed",
        );
        await assertGenerationActive();

        return {
          dimensions: config.dimensions,
          embedding,
          model: config.model,
          provider: config.provider,
          version: config.version,
        };
      } catch (error) {
        throwIfGenerationStopped(error);
        await assertGenerationActive();
        lastError = error;

        const fields = {
          action: "embedding.generate",
          attempt,
          configIndex,
          durationMs: Date.now() - startedAt,
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
    throw lastError;
  }

  throw new AppError("AI_UNAVAILABLE", "Embedding provider unavailable.");
}
