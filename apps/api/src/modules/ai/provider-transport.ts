import { AppError } from "../../shared/errors.js";
import { authorizeProviderDispatch } from "../../shared/abuse-control.js";
import {
  assertGenerationActive,
  beforeGenerationDispatch,
  combineGenerationAbortSignal,
  throwIfGenerationStopped,
} from "../../shared/generation-execution.js";
import { resolveChatProviderConfigs } from "./provider-config.js";
import {
  createChatProviderError,
  createChatProviderFallbackError,
  isAbortError,
} from "./provider-errors.js";
import {
  getChatGenerationOptions,
  getChatProviderPrompt,
} from "./provider-prompts.js";
import { readProviderJson } from "./provider-response.js";
import { chatInputTemplateVersion, promptVersion, safeProviderAccounting,
  type AiExecutionMetadata, type ProviderResult } from "./provider-execution.js";
import {
  getAiProviderTimeoutMs,
  selectChatProviderConfigs,
} from "./provider-routing.js";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function shouldDisableDeepSeekThinking(provider: string, model: string): boolean {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();

  return normalizedProvider.includes("deepseek") || normalizedModel.startsWith("deepseek-");
}

export async function callChatProvider<TOutput>(
  type: string,
  content: string,
): Promise<ProviderResult<TOutput>> {
  await assertGenerationActive();
  const startedAt = Date.now();
  const execution: AiExecutionMetadata = {
    schemaVersion: 1, source: "unavailable", provider: "unavailable", model: "unavailable", taskType: type,
    inputTemplateVersion: chatInputTemplateVersion,
    promptVersion: promptVersion(getChatProviderPrompt(type), getChatGenerationOptions(type)),
    attempts: [], durationMs: 0, cost: "unknown",
  };
  const availableConfigs = (await resolveChatProviderConfigs()).filter((config) => {
    return config.baseUrl.length > 0 && config.model.length > 0 && config.provider.length > 0;
  });
  const configs = selectChatProviderConfigs(availableConfigs, type);
  await assertGenerationActive();

  if (configs.length === 0) {
    throw createChatProviderError("AI provider is not configured.", {
      boundary: "provider_config_resolution",
      kind: "config_missing",
      type,
      execution,
    });
  }

  let lastError: unknown;
  const timeoutMs = getAiProviderTimeoutMs(type);

  for (const config of configs) {
    await assertGenerationActive();
    const attemptStartedAt = Date.now();
    let dispatched = false;
    let accounting: ReturnType<typeof safeProviderAccounting> = {};
    let response: Response;
    let timeout: NodeJS.Timeout | undefined;
    let combined: ReturnType<typeof combineGenerationAbortSignal> | undefined;

    try {
      const requestBody = {
        messages: [
          {
            content: getChatProviderPrompt(type),
            role: "system",
          },
          {
            content,
            role: "user",
          },
        ],
        model: config.model,
        response_format: {
          type: "json_object",
        },
        ...getChatGenerationOptions(type),
        ...(shouldDisableDeepSeekThinking(config.provider, config.model)
          ? { thinking: { type: "disabled" } }
          : {}),
      };

      await authorizeProviderDispatch("chat");
      await beforeGenerationDispatch("chat", type);
      const controller = new AbortController();
      combined = combineGenerationAbortSignal(controller.signal);
      timeout = setTimeout(() => { controller.abort(); }, timeoutMs);
      throwIfGenerationStopped();
      dispatched = true;
      response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json",
          ...(config.apiKey.length === 0 ? {} : { authorization: `Bearer ${config.apiKey}` }),
        },
        method: "POST",
        signal: combined.signal,
      });
      await assertGenerationActive();

      if (!response.ok) {
        throw createChatProviderError("AI provider unavailable.", {
          boundary: "provider_call",
          kind: "http_error",
          statusCode: response.status,
          type,
        });
      }

      const payload: unknown = await response.json();
      accounting = safeProviderAccounting(payload);
      await assertGenerationActive();
      const output = readProviderJson<TOutput>(payload, type);
      execution.attempts.push({ provider: config.provider, model: config.model, profile: config.profile ?? "default",
        outcome: "SUCCEEDED", durationMs: Date.now() - attemptStartedAt, ...accounting });
      execution.source = "provider";
      execution.provider = config.provider;
      execution.model = accounting.responseModel ?? config.model;
      execution.durationMs = Date.now() - startedAt;
      return { output, execution };
    } catch (error) {
      throwIfGenerationStopped(error);
      await assertGenerationActive();
      if (dispatched) {
        const details = error instanceof AppError && typeof error.details === "object" && error.details !== null
          ? error.details as Record<string, unknown> : {};
        execution.attempts.push({ provider: config.provider, model: config.model, profile: config.profile ?? "default",
          outcome: "FAILED", durationMs: Date.now() - attemptStartedAt, ...accounting,
          failureKind: typeof details.kind === "string" ? details.kind : isAbortError(error) ? "timeout" : "network_error",
          ...(typeof details.statusCode === "number" ? { statusCode: details.statusCode } : {}) });
      }
      if (error instanceof AppError) {
        lastError = error;
        continue;
      }

      if (isAbortError(error)) {
        lastError = createChatProviderError("AI provider timed out.", {
          boundary: "provider_call",
          kind: "timeout",
          timeoutMs,
          type,
        });
        continue;
      }

      lastError = createChatProviderError("AI provider unavailable.", {
        boundary: "provider_call",
        kind: "network_error",
        type,
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      combined?.dispose();
    }
  }

  await assertGenerationActive();
  if (lastError instanceof AppError) {
    execution.durationMs = Date.now() - startedAt;
    const error = createChatProviderFallbackError(lastError, configs.length);
    throw new AppError(error.code, error.message, { ...error.details as Record<string, unknown>, execution });
  }

  throw new AppError("AI_UNAVAILABLE", "AI provider unavailable.");
}
