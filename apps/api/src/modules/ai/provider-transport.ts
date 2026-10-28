import { AppError } from "../../shared/errors.js";
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
  const availableConfigs = (await resolveChatProviderConfigs()).filter((config) => {
    return config.baseUrl.length > 0 && config.model.length > 0 && config.provider.length > 0;
  });
  const configs = selectChatProviderConfigs(availableConfigs, type);

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
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

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

      response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json",
          ...(config.apiKey.length === 0 ? {} : { authorization: `Bearer ${config.apiKey}` }),
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw createChatProviderError("AI provider unavailable.", {
          boundary: "provider_call",
          kind: "http_error",
          statusCode: response.status,
          type,
        });
      }

      return readProviderJson<TOutput>(await response.json(), type);
    } catch (error) {
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
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof AppError) {
    throw createChatProviderFallbackError(lastError, configs.length);
  }

  throw new AppError("AI_UNAVAILABLE", "AI provider unavailable.");
}
