import { describe, expect, it, vi } from "vitest";
import { embeddingNormalization, embeddingSpaceKey, isEmbeddingSpaceKey, signalEmbeddingText } from "./embedding-space.js";
import { embeddingBackfillPlan, parseBackfillOptions } from "./embedding-backfill-plan.js";
import { generateEmbedding } from "./embedding.js";
import { buildSignalEmbeddingText } from "../signals/service-embedding.js";
import { fixtureFingerprint, fixtureClassification } from "../../../tests/integration/fixtures.js";

const config = { provider: "synthetic", model: "embed-a", dimensions: 3, version: "v1",
  apiKey: "never-copy-secret", baseUrl: "https://synthetic.invalid/v1" };
describe("embedding spaces and bounded backfill", () => {
  it("separates provider, model, dimensions, manual version and input template", () => {
    const original = embeddingSpaceKey(config);
    expect(isEmbeddingSpaceKey(original)).toBe(true);
    expect(embeddingNormalization).toBe("provider-output-cosine-v1");
    const rotatedKey = { ...config, apiKey: "other" };
    expect(embeddingSpaceKey(rotatedKey)).toBe(original);
    for (const patch of [{ provider: "another" }, { model: "embed-b" }, { dimensions: 4 }, { version: "v2" }]) {
      expect(embeddingSpaceKey({ ...config, ...patch })).not.toBe(original);
    }
    expect(embeddingSpaceKey(config, "signal-body-v2")).not.toBe(original);
    expect(isEmbeddingSpaceKey("v1")).toBe(false);
  });
  it("reproduces one body-only input across creation, detail and backfill", () => {
    expect(signalEmbeddingText("  公开正文\r\n第二行  ")).toBe("正文：公开正文\n第二行");
    const creation = buildSignalEmbeddingText({ expandedText: "公开正文", fingerprint: fixtureFingerprint,
      classification: fixtureClassification, seedText: "PRIVATE-SEED" });
    const readOrBackfill = buildSignalEmbeddingText({ expandedText: "公开正文", fingerprint: { ...fixtureFingerprint, title: "PRIVATE-TITLE" } });
    expect(creation).toBe(readOrBackfill);
    expect(creation).toBe("正文：公开正文");
  });
  it("defaults to preview, limits the batch and accounts retry/fallback upper bounds without inventing money", () => {
    expect(parseBackfillOptions([])).toEqual({ apply: false, limit: 100 });
    expect(parseBackfillOptions(["--limit=2", "--apply"])).toEqual({ apply: true, limit: 2 });
    for (const args of [["--limit=0"], ["--limit=1001"], ["--limit=1", "--limit=2"], ["--all"], ["--apply", "--apply"]]) {
      expect(() => parseBackfillOptions(args)).toThrow();
    }
    const rows = [{ id: "synthetic-id", expandedText: "公开正文" }];
    const plan = embeddingBackfillPlan(rows, [config, { ...config, model: "backup" }]);
    expect(plan).toMatchObject({ rows: 1, inputCharacters: 7, maxDispatches: 8,
      maxDispatchedCharacters: 56, currencyCost: "unknown", overwritesExistingVectors: false });
    expect(JSON.stringify(plan)).not.toMatch(/公开正文|never-copy-secret|synthetic.invalid/u);
    expect(embeddingBackfillPlan(rows, [config]).planKey).not.toBe(embeddingBackfillPlan([{ ...rows[0], expandedText: "另一个正文" }], [config]).planKey);
  });
  it("keys a fallback embedding from the model that executed and exposes safe query accounting", async () => {
    const fetch = vi.fn().mockImplementationOnce(async () => new Response("{}", { status: 503 }))
      .mockImplementationOnce(async () => new Response("{}", { status: 503 }))
      .mockImplementationOnce(async () => new Response("{}", { status: 503 }))
      .mockImplementationOnce(async () => new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "embed-actual", data: [{ embedding: [1, 2, 3] }], usage: { total_tokens: 9, raw: "never-copy" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const info = vi.fn();
    try {
      const result = await generateEmbedding(signalEmbeddingText("公开正文"), { configs: [config, { ...config, model: "backup" }], retryDelayMs: 0, purpose: "public-detail",
        logger: { info, warn: vi.fn(), error: vi.fn() } });
      expect(result).toMatchObject({ model: "embed-actual", version: embeddingSpaceKey({ ...config, model: "embed-actual" }) });
      expect(info).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "public-detail", cost: "unknown", inputCharacters: 7,
        usage: { total_tokens: 9 } }), expect.any(String));
      expect(fetch).toHaveBeenCalledTimes(5);
      expect(result.execution?.attempts.map((attempt) => [attempt.model, attempt.outcome])).toEqual([
        ["embed-a", "FAILED"], ["embed-a", "FAILED"], ["embed-a", "FAILED"], ["embed-a", "FAILED"], ["backup", "SUCCEEDED"],
      ]);
      expect(JSON.stringify(info.mock.calls)).not.toMatch(/公开正文|never-copy|synthetic.invalid/u);
    } finally { vi.unstubAllGlobals(); }
  });
});
