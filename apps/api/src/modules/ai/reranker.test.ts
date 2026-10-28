import { beforeEach, describe, expect, it, vi } from "vitest";
import { rerankCandidates } from "./reranker.js";

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("reranker adapter", () => {
  it("adapts SiliconFlow requests and maps response indexes to candidate ids", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({
        documents: ["第一段候选信号", "第二段候选信号"],
        model: "Qwen/Qwen3-Reranker-0.6B",
        query: "测试文本",
      });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                index: 1,
                relevance_score: 0.82,
              },
              {
                index: 0,
                relevance_score: 0.41,
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await rerankCandidates(
      {
        candidates: [
          {
            distance: 0.2,
            expandedText: "第一段候选信号",
            id: "candidate-a",
          },
          {
            distance: 0.1,
            expandedText: "第二段候选信号",
            id: "candidate-b",
          },
        ],
        queryText: "测试文本",
      },
      {
        apiKey: "sk-test",
        baseUrl: "https://api.siliconflow.com/v1",
        model: "Qwen/Qwen3-Reranker-0.6B",
        provider: "siliconflow",
      },
    );

    expect(result).toEqual({
      model: "Qwen/Qwen3-Reranker-0.6B",
      provider: "siliconflow",
      results: [
        {
          id: "candidate-b",
          reason: "reranker",
          score: 0.82,
        },
        {
          id: "candidate-a",
          reason: "reranker",
          score: 0.41,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.siliconflow.com/v1/rerank",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("keeps the generic reranker candidate payload for other providers", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({
        candidates: [
          {
            distance: 0.2,
            expandedText: "第一段候选信号",
            id: "candidate-a",
          },
        ],
        model: "generic-reranker",
        query: "测试文本",
      });

      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "candidate-a",
                reason: "matched",
                score: 0.66,
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await rerankCandidates(
      {
        candidates: [
          {
            distance: 0.2,
            expandedText: "第一段候选信号",
            id: "candidate-a",
          },
        ],
        queryText: "测试文本",
      },
      {
        apiKey: "sk-test",
        baseUrl: "https://reranker.example.com/v1",
        model: "generic-reranker",
        provider: "openai-compatible",
      },
    );

    expect(result.results).toEqual([
      {
        id: "candidate-a",
        reason: "matched",
        score: 0.66,
      },
    ]);
  });
});
