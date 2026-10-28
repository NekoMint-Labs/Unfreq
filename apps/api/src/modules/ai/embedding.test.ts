import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import {
  generateEmbedding,
  signalEmbeddingDimensions,
  validateEmbeddingVector,
} from "./embedding.js";

function buildEmbedding(value: number): number[] {
  return Array.from({ length: signalEmbeddingDimensions }, () => value);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("embedding adapter", () => {
  it("returns a validated DashScope-compatible embedding vector", async () => {
    const embedding = buildEmbedding(0.25);
    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                embedding,
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateEmbedding("一段需要匹配的信号", {
      config: {
        apiKey: "test-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
        dimensions: signalEmbeddingDimensions,
        model: "text-embedding-v3",
        provider: "dashscope",
        version: "v1",
      },
      retryDelayMs: 0,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      dimensions: signalEmbeddingDimensions,
      embedding,
      model: "text-embedding-v3",
      provider: "dashscope",
      version: "v1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("retries provider failures before returning AI_UNAVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        return Promise.resolve(new Response("{}", { status: 503 }));
      }),
    );

    await expect(
      generateEmbedding("一段需要匹配的信号", {
        config: {
          apiKey: "test-key",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          dimensions: signalEmbeddingDimensions,
          model: "text-embedding-v3",
          provider: "dashscope",
          version: "v1",
        },
        retryDelayMs: 0,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects invalid embedding dimensions", () => {
    expect(() => validateEmbeddingVector([0.1, 0.2])).toThrow(AppError);
  });

  it("rejects non-numeric embedding values", () => {
    const invalidEmbedding = buildEmbedding(0.1);
    invalidEmbedding[3] = Number.NaN;

    expect(() => validateEmbeddingVector(invalidEmbedding)).toThrow(AppError);
    expect(() => validateEmbeddingVector([...buildEmbedding(0.1), null].slice(1))).toThrow(
      AppError,
    );
  });

  it("rejects empty input without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateEmbedding("   ", {
        config: {
          apiKey: "test-key",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          dimensions: signalEmbeddingDimensions,
          model: "text-embedding-v3",
          provider: "dashscope",
          version: "v1",
        },
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
