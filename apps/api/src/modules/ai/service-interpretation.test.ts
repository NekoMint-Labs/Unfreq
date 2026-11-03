import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureFingerprint, fixtureMaterial } from "../../../tests/integration/fixtures.js";
import { AppError } from "../../shared/errors.js";
import { generateSignalFingerprintWithFallback, generateSignalMaterial } from "./service.js";
import { signalFingerprintWithProvider, signalMaterialWithProvider } from "./provider.js";
import { createAiReviewRecord } from "./repository.js";
import type { ProviderResult } from "./provider-execution.js";
import type { AiSignalFingerprint, AiSignalMaterial } from "./signal-types.js";

vi.mock("./repository.js", () => ({ createAiReviewRecord: vi.fn(async (params) => ({ ...params, id: "synthetic-review" })) }));
vi.mock("./provider.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./provider.js")>(),
  signalFingerprintWithProvider: vi.fn(), signalMaterialWithProvider: vi.fn(),
}));

// Deliberately inject untrusted wire payloads at the mocked adapter boundary.
// The real service parser, rather than this test helper, must reject bad fields.
function result<T>(output: unknown): ProviderResult<T> {
  return { output: output as T, execution: { schemaVersion: 1, taskType: "synthetic", source: "provider",
    provider: "synthetic", model: "synthetic", inputTemplateVersion: "synthetic", promptVersion: "synthetic",
    durationMs: 1, attempts: [], cost: "unknown" } };
}
beforeEach(() => { vi.mocked(signalFingerprintWithProvider).mockReset(); vi.mocked(signalMaterialWithProvider).mockReset(); vi.mocked(createAiReviewRecord).mockClear(); });

describe("server-attributed fingerprint interpretation", () => {
  it("overrides a provider's self-certification on the separate fingerprint path", async () => {
    vi.mocked(signalFingerprintWithProvider).mockResolvedValue(result<AiSignalFingerprint>({ ...fixtureFingerprint,
      interpretation: { version: 1, state: "verified", source: "provider", accuracy: 1 } }));
    const generated = await generateSignalFingerprintWithFallback({ content: "今天吃到喜欢的冰淇淋。" });
    expect(generated.result.interpretation).toEqual({ version: 1, state: "unverified", source: "provider" });
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({ source: "provider" }),
      outputJson: expect.objectContaining({ interpretation: generated.result.interpretation }),
    }));
  });

  it("attributes the combined material path without accepting model-supplied confidence", async () => {
    vi.mocked(signalMaterialWithProvider).mockResolvedValue(result<AiSignalMaterial>({ ...fixtureMaterial,
      fingerprint: { ...fixtureFingerprint, interpretation: { version: 1, state: "verified", source: "rules" } } }));
    const generated = await generateSignalMaterial({ content: "考试通过了，我很开心。" });
    expect(generated.result.fingerprint.interpretation).toEqual({ version: 1, state: "unverified", source: "provider" });
    expect(generated.result.expansion.expandedText).toBe(fixtureMaterial.expansion.expandedText);
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({
      reviewType: "signal-material", outputJson: expect.objectContaining({ fingerprint: expect.objectContaining({ interpretation: generated.result.fingerprint.interpretation }) }),
    }));
  });

  it("attributes invalid provider business output to rules, retaining its audit trail", async () => {
    vi.mocked(signalFingerprintWithProvider).mockResolvedValue(result<AiSignalFingerprint>({ ...fixtureFingerprint, energy: 2 }));
    const generated = await generateSignalFingerprintWithFallback({ content: "月亮今天请假。" });
    expect(generated.result.interpretation).toEqual({ version: 1, state: "unknown", source: "rules" });
    expect(generated.result.coreNeed).toBe("暂不作心理解读");
    expect(createAiReviewRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "FALLBACK",
      execution: expect.objectContaining({ source: "rules", fallbackReason: "invalid_business_output" }),
    }));
  });

  it("keeps provider outages unknown rather than upgrading a rule fallback", async () => {
    vi.mocked(signalFingerprintWithProvider).mockRejectedValue(new AppError("AI_UNAVAILABLE", "synthetic unavailable"));
    const generated = await generateSignalFingerprintWithFallback({ content: "最近考试让我焦虑。" });
    expect(generated.result.interpretation).toEqual({ version: 1, state: "unknown", source: "rules" });
    expect(generated.result.tags).toEqual([]);
    expect(signalFingerprintWithProvider).toHaveBeenCalledTimes(1);
  });
});
