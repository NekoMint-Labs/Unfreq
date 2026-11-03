import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRerankerProviderConfigured, rerankCandidates } from "./reranker.js";
import type { RerankerProviderConfig } from "./provider-config.js";

const state = vi.hoisted(() => ({ configs: [] as RerankerProviderConfig[] }));
vi.mock("./provider-config.js", () => ({ resolveRerankerProviderConfigs: async () => state.configs }));
const candidates = [{ id: "a", expandedText: "PRIVATE_CANDIDATE", distance: 0.2 }, { id: "b", expandedText: "PUBLIC_CANDIDATE", distance: 0.3 }];
const config = { provider: "synthetic-primary", model: "request-model", apiKey: "SECRET_KEY", baseUrl: "https://synthetic.invalid/v1", scoreScale: "zero_to_one" };
beforeEach(() => { vi.unstubAllGlobals(); state.configs = [config]; });
describe("rerank contract admission and actual execution costs", () => {
  it("does not dispatch an undeclared model range, even when keys are present", async () => {
    state.configs = [{ ...config, scoreScale: "" }];
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await isRerankerProviderConfigured()).toBe(false);
    await expect(rerankCandidates({ queryText: "PRIVATE_QUERY", candidates })).rejects.toMatchObject({ code: "AI_UNAVAILABLE",
      details: { execution: { attempts: [], cost: "unknown" } } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("finds a declared backup when the first configuration has no usable score contract", async () => {
    state.configs = [{ ...config, scoreScale: "" }, { ...config, provider: "backup", scoreScale: "zero_to_hundred" }];
    expect(await isRerankerProviderConfigured()).toBe(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [{ id: "a", score: 80 }, { id: "b", score: 20 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await rerankCandidates({ queryText: "PRIVATE_QUERY", candidates });
    expect(result).toMatchObject({ provider: "backup", results: [{ id: "a", score: 0.8 }, { id: "b", score: 0.2 }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains charged invalid attempts and a complete backup batch without mixing their scores", async () => {
    state.configs.push({ ...config, provider: "backup", model: "backup-request", scoreScale: "zero_to_hundred" });
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ usage: { total_tokens: 7 }, results: [{ id: "a", score: 0.9 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "backup-actual", meta: { tokens: { input_tokens: 10, output_tokens: 2, raw: "PRIVATE_QUERY" } },
        results: [{ id: "a", score: 80 }, { id: "b", score: 20 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const info = vi.fn();
    const result = await rerankCandidates({ queryText: "PRIVATE_QUERY", candidates }, undefined, { logger: { info, warn: vi.fn(), error: vi.fn() } });
    expect(result).toMatchObject({ provider: "backup", model: "backup-actual", scoreScale: "zero_to_one", results: [{ id: "a", rawScore: 80, score: 0.8 }, { id: "b", rawScore: 20, score: 0.2 }],
      execution: { cost: "unknown", attempts: [{ provider: "synthetic-primary", outcome: "FAILED", failureKind: "invalid_score_batch", usage: { total_tokens: 7 } },
        { provider: "backup", outcome: "SUCCEEDED", usage: { input_tokens: 10, output_tokens: 2 } }] } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE_QUERY|PRIVATE_CANDIDATE|SECRET_KEY|synthetic.invalid/u);
  });
});
