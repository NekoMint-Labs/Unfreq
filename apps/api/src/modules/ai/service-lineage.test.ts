import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyContentWithFallback } from "./service.js";
import type { ChatProviderConfig } from "./provider-config.js";
import { createAiReviewRecord } from "./repository.js";

const state = vi.hoisted(() => ({ configs: [] as ChatProviderConfig[] }));
vi.mock("./provider-config.js", () => ({ resolveChatProviderConfigs: vi.fn(async () => state.configs) }));
vi.mock("./repository.js", () => ({ createAiReviewRecord: vi.fn(async (params) => ({ ...params, id: "synthetic-review" })) }));
const config = (model: string, profile: "default" | "fast"): ChatProviderConfig => ({
  apiKey: "synthetic-secret-never-log", baseUrl: "https://synthetic.invalid/v1", model, provider: `provider-${model}`, profile,
});
function response(model = "fast-actual") {
  return new Response(JSON.stringify({ model, usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17,
    secret: "must-not-copy" }, secret: "must-not-copy", choices: [{ message: { content: JSON.stringify({
    channel: "MIDNIGHT", confidence: 0.9, reason: "synthetic reason",
  }) } }] }), { status: 200 });
}
beforeEach(() => { vi.unstubAllGlobals(); vi.mocked(createAiReviewRecord).mockClear(); state.configs = [config("first", "default"), config("fast", "fast")]; });

describe("transport-to-audit provider lineage", () => {
  it("records the fast provider and reported model without resolving a guessed first config", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    await classifyContentWithFallback({ content: "synthetic private input" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ provider: "provider-fast", model: "fast-actual",
      execution: expect.objectContaining({ source: "provider", taskType: "classify", promptVersion: expect.stringMatching(/^sha256:/u),
        attempts: [expect.objectContaining({ model: "fast", profile: "fast", responseModel: "fast-actual", usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } })] }) }));
    const metadata = JSON.stringify(vi.mocked(createAiReviewRecord).mock.calls[0]?.[0].execution);
    expect(metadata).not.toMatch(/private input|synthetic-secret|synthetic.invalid|must-not-copy/u);
  });

  it("keeps the ordered failure trail when a backup really executes", async () => {
    state.configs = [config("primary", "fast"), config("backup", "fast")];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(response("backup-actual")));
    await classifyContentWithFallback({ content: "synthetic" });
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ provider: "provider-backup", model: "backup-actual",
      execution: expect.objectContaining({ attempts: [expect.objectContaining({ model: "primary", outcome: "FAILED", statusCode: 503 }),
        expect.objectContaining({ model: "backup", outcome: "SUCCEEDED" })] }) }));
  });

  it("attributes rule degradation to rules while retaining failed paid attempts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await classifyContentWithFallback({ content: "synthetic" });
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ provider: "local-rules", model: "local-rules-v1", status: "FALLBACK",
      execution: expect.objectContaining({ source: "rules", attempts: [expect.objectContaining({ model: "fast", outcome: "FAILED" })] }) }));
  });

  it("keeps successful transport usage when business validation falls back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ usage: { total_tokens: 8 }, choices: [{ message: { content: "{}" } }] }), { status: 200 })));
    await classifyContentWithFallback({ content: "synthetic" });
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ provider: "local-rules", execution: expect.objectContaining({ fallbackReason: "invalid_business_output",
      attempts: [expect.objectContaining({ outcome: "SUCCEEDED", usage: { total_tokens: 8 } })] }) }));
  });

  it("does not add another provider dispatch if audit persistence fails", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    vi.mocked(createAiReviewRecord).mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(classifyContentWithFallback({ content: "synthetic" })).rejects.toThrow("storage unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("records rules with no invented provider attempt when configuration is missing", async () => {
    state.configs = [];
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await classifyContentWithFallback({ content: "synthetic" });
    expect(fetch).not.toHaveBeenCalled();
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ provider: "local-rules",
      execution: expect.objectContaining({ source: "rules", attempts: [], promptVersion: expect.stringMatching(/^sha256:/u) }) }));
  });
});
