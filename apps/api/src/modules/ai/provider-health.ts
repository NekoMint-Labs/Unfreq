import type {
  AdminProviderConfigBody,
  AdminProviderConfigKind,
  AdminProviderConfigTestResult,
} from "@unfreq/contracts/admin";
import { buildRerankerRequestBody, parseRerankerResponsePayload } from "./reranker-adapter.js";

type DraftConfig = {
  apiKey: string;
  baseUrl: string;
  extraJson: Record<string, unknown>;
  kind: AdminProviderConfigKind;
  model: string;
  provider: string;
};

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

type ChatPayload = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

const providerTestTimeoutMs = 8_000;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function readNumberExtra(
  extraJson: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = extraJson[key];

  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readDraftConfig(kind: AdminProviderConfigKind, body: AdminProviderConfigBody): DraftConfig {
  return {
    apiKey: body.apiKey?.trim() ?? "",
    baseUrl: body.baseUrl.trim(),
    extraJson: body.extraJson ?? {},
    kind,
    model: body.model.trim(),
    provider: body.provider.trim(),
  };
}

function buildResult(params: {
  checkedUrl?: string;
  detail: string;
  durationMs: number;
  kind: AdminProviderConfigKind;
  model: string;
  provider: string;
  reason: AdminProviderConfigTestResult["reason"];
  status: AdminProviderConfigTestResult["status"];
}): AdminProviderConfigTestResult {
  return params;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function hasUsableEmbedding(payload: EmbeddingPayload, dimensions: number): boolean {
  const embedding = payload.data?.[0]?.embedding ?? payload.output?.embeddings?.[0]?.embedding;

  return (
    Array.isArray(embedding) &&
    embedding.length === dimensions &&
    embedding.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function readChatPayloadStatus(
  payload: ChatPayload,
): "invalid_json" | "invalid_response" | "ok" {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.length === 0) {
    return "invalid_response";
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? "ok"
      : "invalid_response";
  } catch {
    return "invalid_json";
  }
}

async function requestJson(params: {
  apiKey: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  url: string;
}): Promise<{ payload?: unknown; response: Response }> {
  const response = await fetch(params.url, {
    body: JSON.stringify(params.body),
    headers: {
      ...(params.apiKey.length === 0 ? {} : { authorization: `Bearer ${params.apiKey}` }),
      "content-type": "application/json",
    },
    method: "POST",
    signal: params.signal,
  });

  if (!response.ok) {
    return { response };
  }

  try {
    return {
      payload: await response.json(),
      response,
    };
  } catch {
    return {
      payload: undefined,
      response,
    };
  }
}

export async function testProviderConfig(
  kind: AdminProviderConfigKind,
  body: AdminProviderConfigBody,
): Promise<AdminProviderConfigTestResult> {
  const config = readDraftConfig(kind, body);
  const startedAt = Date.now();

  if (
    config.baseUrl.length === 0 ||
    config.model.length === 0 ||
    config.provider.length === 0 ||
    (kind !== "chat" && config.apiKey.length === 0)
  ) {
    return buildResult({
      detail: "baseUrl、provider、model 或 API key 缺失。",
      durationMs: Date.now() - startedAt,
      kind,
      model: config.model,
      provider: config.provider,
      reason: "missing_config",
      status: "failed",
    });
  }

  if (kind === "tts") {
    return buildResult({
      detail: "TTS 真实音频探测暂未接入。请用发音频功能验证。",
      durationMs: Date.now() - startedAt,
      kind,
      model: config.model,
      provider: config.provider,
      reason: "not_supported",
      status: "unsupported",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, providerTestTimeoutMs);
  const checkedUrl =
    kind === "chat"
      ? `${normalizeBaseUrl(config.baseUrl)}/chat/completions`
      : kind === "embedding"
        ? `${normalizeBaseUrl(config.baseUrl)}/embeddings`
        : `${normalizeBaseUrl(config.baseUrl)}/rerank`;

  try {
    const rerankerTestCandidates = [
      {
        expandedText: "一段安静的测试文本。",
        id: "candidate-a",
      },
      {
        expandedText: "另一段用于排序的测试文本。",
        id: "candidate-b",
      },
    ];
    const requestBody =
      kind === "chat"
        ? {
            messages: [
              {
                content: "Return only JSON: {\"ok\":true}.",
                role: "system",
              },
              {
                content: "health check",
                role: "user",
              },
            ],
            model: config.model,
            response_format: {
              type: "json_object",
            },
            temperature: 0,
          }
        : kind === "embedding"
          ? {
              dimensions: readNumberExtra(config.extraJson, "dimensions", 1024),
              encoding_format: "float",
              input: ["health check"],
              model: config.model,
            }
          : buildRerankerRequestBody({
              candidates: rerankerTestCandidates,
              model: config.model,
              provider: config.provider,
              queryText: "测试文本",
            });

    const { payload, response } = await requestJson({
      apiKey: config.apiKey,
      body: requestBody,
      signal: controller.signal,
      url: checkedUrl,
    });
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      return buildResult({
        checkedUrl,
        detail: `Provider 返回 HTTP ${response.status}。`,
        durationMs,
        kind,
        model: config.model,
        provider: config.provider,
        reason: "http_error",
        status: "failed",
      });
    }

    const chatPayloadStatus =
      kind === "chat" ? readChatPayloadStatus(payload as ChatPayload) : "ok";
    const isPayloadValid =
      kind === "chat"
        ? chatPayloadStatus === "ok"
        : kind === "embedding"
          ? hasUsableEmbedding(
              payload as EmbeddingPayload,
              readNumberExtra(config.extraJson, "dimensions", 1024),
            )
          : parseRerankerResponsePayload({
              candidates: rerankerTestCandidates,
              payload,
              provider: config.provider,
            }).length > 0;

    if (!isPayloadValid) {
      return buildResult({
        checkedUrl,
        detail:
          chatPayloadStatus === "invalid_json"
            ? "Provider 响应成功，但 choices[0].message.content 不是合法 JSON。"
            : "Provider 响应成功，但返回结构不符合当前代码要求。",
        durationMs,
        kind,
        model: config.model,
        provider: config.provider,
        reason: chatPayloadStatus === "invalid_json" ? "invalid_json" : "invalid_response",
        status: "failed",
      });
    }

    return buildResult({
      checkedUrl,
      detail: "Provider 可用，响应结构符合当前代码要求。",
      durationMs,
      kind,
      model: config.model,
      provider: config.provider,
      reason: "ok",
      status: "passed",
    });
  } catch (error) {
    return buildResult({
      checkedUrl,
      detail: isAbortError(error) ? "Provider 请求超时。" : "Provider 请求失败，可能是网络或域名问题。",
      durationMs: Date.now() - startedAt,
      kind,
      model: config.model,
      provider: config.provider,
      reason: isAbortError(error) ? "timeout" : "network_error",
      status: "failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}
