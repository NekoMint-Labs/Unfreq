import { AppError } from "../../shared/errors.js";
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
): Promise<TOutput> {
  await assertGenerationActive();
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
    });
  }

  let lastError: unknown;
  const timeoutMs = getAiProviderTimeoutMs(type);

  for (const config of configs) {
    await assertGenerationActive();
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

      await beforeGenerationDispatch("chat", type);
      const controller = new AbortController();
      combined = combineGenerationAbortSignal(controller.signal);
      timeout = setTimeout(() => { controller.abort(); }, timeoutMs);
      throwIfGenerationStopped();
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
      await assertGenerationActive();
      return readProviderJson<TOutput>(payload, type);
    } catch (error) {
      throwIfGenerationStopped(error);
      await assertGenerationActive();
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
    throw createChatProviderFallbackError(lastError, configs.length);
  }

  throw new AppError("AI_UNAVAILABLE", "AI provider unavailable.");
}
