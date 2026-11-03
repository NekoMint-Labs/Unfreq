import { beforeEach, describe, expect, it, vi } from "vitest";
import { testProviderConfig } from "./provider-health.js";
import { authorizeProviderDispatch } from "../../shared/abuse-control.js";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";

vi.mock("../../shared/abuse-control.js", () => ({ authorizeProviderDispatch: vi.fn() }));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(authorizeProviderDispatch).mockReset().mockResolvedValue(undefined);
});

describe("provider health checks", () => {
  it.each([
    ["chat", "limited"], ["chat", "unavailable"],
    ["embedding", "limited"], ["embedding", "unavailable"],
    ["reranker", "limited"], ["reranker", "unavailable"],
  ] as const)("does not dispatch a %s probe when shared protection is %s", async (kind, reason) => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const rule = { chat: "chatCallsSite", embedding: "embeddingCallsSite", reranker: "rerankerCallsSite" } as const;
    const stopped = new AbuseControlStopped(reason, rule[kind], 1000);
    vi.mocked(authorizeProviderDispatch).mockRejectedValueOnce(stopped);
    await expect(testProviderConfig(kind, {
      apiKey: "synthetic-probe-key", baseUrl: "https://probe.invalid/v1", model: "synthetic", provider: "synthetic", extraJson: { scoreScale: "zero_to_one" },
    })).rejects.toBe(stopped);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tests chat providers against chat completions endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "{\"ok\":true}",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testProviderConfig("chat", {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1/",
      extraJson: {},
      model: "chat-model",
      provider: "openai-compatible",
    });

    expect(result).toMatchObject({
      checkedUrl: "https://chat.example.com/v1/chat/completions",
      reason: "ok",
      status: "passed",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("tests embedding providers against embeddings endpoint and dimensions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  embedding: [0.1, 0.2],
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    const result = await testProviderConfig("embedding", {
      apiKey: "sk-test",
      baseUrl: "https://api.siliconflow.com/v1",
      extraJson: {
        dimensions: 3,
      },
      model: "Qwen/Qwen3-Embedding-0.6B",
      provider: "siliconflow",
    });

    expect(result).toMatchObject({
      checkedUrl: "https://api.siliconflow.com/v1/embeddings",
      reason: "invalid_response",
      status: "failed",
    });
  });

  it("returns HTTP status for provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 401 }))),
    );

    const result = await testProviderConfig("embedding", {
      apiKey: "bad-key",
      baseUrl: "https://api.siliconflow.com/v1",
      extraJson: {
        dimensions: 1024,
      },
      model: "Qwen/Qwen3-Embedding-0.6B",
      provider: "siliconflow",
    });

    expect(result).toMatchObject({
      checkedUrl: "https://api.siliconflow.com/v1/embeddings",
      detail: "Provider 返回 HTTP 401。",
      reason: "http_error",
      status: "failed",
    });
  });

  it("tests SiliconFlow rerank providers with documents payload", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({
        documents: ["一段安静的测试文本。", "另一段用于排序的测试文本。"],
        model: "Qwen/Qwen3-Reranker-0.6B",
        query: "测试文本",
        top_n: 2, return_documents: false,
      });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                index: 0,
                relevance_score: 0.91,
              }, { index: 1, relevance_score: 0.4 },
            ],
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testProviderConfig("reranker", {
      apiKey: "sk-test",
      baseUrl: "https://api.siliconflow.com/v1",
      extraJson: { scoreScale: "zero_to_one" },
      model: "Qwen/Qwen3-Reranker-0.6B",
      provider: "siliconflow",
    });

    expect(result).toMatchObject({
      checkedUrl: "https://api.siliconflow.com/v1/rerank",
      reason: "ok",
      status: "passed",
    });
  });

  it("reports chat content that is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "ok",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    const result = await testProviderConfig("chat", {
      baseUrl: "https://chat.example.com/v1",
      extraJson: {},
      model: "chat-model",
      provider: "openai-compatible",
    });

    expect(result).toMatchObject({
      detail: "Provider 响应成功，但 choices[0].message.content 不是合法 JSON。",
      reason: "invalid_json",
      status: "failed",
    });
  });
});
