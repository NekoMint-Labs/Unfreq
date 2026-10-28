import { createChatProviderError } from "./provider-errors.js";

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export function extractChatCompletionContent(payload: unknown, type: string): string {
  const raw = (payload as ChatCompletionPayload).choices?.[0]?.message?.content;

  if (typeof raw !== "string" || raw.length === 0) {
    throw createChatProviderError("AI provider returned an invalid response.", {
      boundary: "provider_call",
      kind: "invalid_response",
      type,
    });
  }

  return raw;
}

export function parseProviderJson<TOutput>(raw: string, type: string): TOutput {
  try {
    return JSON.parse(raw) as TOutput;
  } catch {
    throw createChatProviderError("AI provider returned invalid JSON.", {
      boundary: "provider_call",
      kind: "invalid_json",
      type,
    });
  }
}

export function readProviderJson<TOutput>(payload: unknown, type: string): TOutput {
  return parseProviderJson<TOutput>(extractChatCompletionContent(payload, type), type);
}
