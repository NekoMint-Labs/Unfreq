import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationExecutionStopped, runWithGenerationExecution, type GenerationExecutionContext } from "../../shared/generation-execution.js";
import { fixtureFingerprint } from "../../../tests/integration/fixtures.js";
import { findSameFrequencyMatches } from "./service-matching.js";
import type { SignalSemanticMatchRecord } from "./types.js";

const calls = vi.hoisted(() => ({
  embeddingConfigured: vi.fn(), embedding: vi.fn(), rerankerConfigured: vi.fn(), rerank: vi.fn(),
  semantic: vi.fn(), keyword: vi.fn(),
}));
vi.mock("../ai/embedding.js", () => ({ isEmbeddingProviderConfigured: calls.embeddingConfigured, generateEmbedding: calls.embedding }));
vi.mock("../ai/reranker.js", () => ({ isRerankerProviderConfigured: calls.rerankerConfigured, rerankCandidates: calls.rerank }));
vi.mock("./repository.js", () => ({ listPublishedSemanticSignalMatchCandidates: calls.semantic, listPublishedSignalMatchCandidates: calls.keyword }));
vi.mock("./service-embedding.js", () => ({ buildSignalEmbeddingText: () => "synthetic embedding input" }));

const candidate: SignalSemanticMatchRecord = {
  id: "synthetic-candidate", authorId: null, authorFreqCode: "FM-UNIT", frequencyId: null,
  audioError: null, audioStatus: "NOT_REQUESTED", audioStorageKey: null, audioStorageKeyLeft: null, audioStorageKeyRight: null,
  audioUrl: null, audioUrlLeft: null, audioUrlRight: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  echoCount: 0, resonanceCount: 0, resonanceKeywords: null, expandedText: "synthetic public candidate", seedText: "synthetic candidate seed", rawInput: "synthetic candidate seed",
  fingerprintJson: fixtureFingerprint, followUpQuestion: null, galaxyPosition: null,
  embedding: [0.1, 0.2, 0.3], embeddingDimensions: 3, embeddingModel: "synthetic", embeddingProvider: "synthetic", embeddingVersion: "unit-v1", distance: 0.2,
  generationError: null, generationStatus: "COMPLETED", guestKey: null,
  coreNeed: null, emotionTone: null, innerConflict: null, matchSignalId: null, parentSignalId: null,
  primaryBand: "self_mirror", programJson: { bridgeNarration: "synthetic", closingQuestion: "synthetic?", hostIntro: "synthetic", leftSignalSummary: "synthetic", programTitle: "synthetic", shareQuote: "synthetic" },
  qualityReason: null, qualityScore: null, source: "human", status: "PUBLISHED", subFeeling: "self_acceptance", isKept: false,
};
const input = { expandedText: "synthetic expansion", fingerprint: fixtureFingerprint, rawInput: "synthetic input" };

function execution() {
  const controller = new AbortController();
  const ctx: GenerationExecutionContext = {
    attemptId: "synthetic-matching-attempt", signal: controller.signal,
    assertActive: vi.fn(async () => {}), beforeDispatch: vi.fn(async () => {}),
  };
  return { controller, ctx };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  calls.embeddingConfigured.mockReset().mockResolvedValue(true);
  calls.embedding.mockReset().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], dimensions: 3, model: "synthetic", provider: "synthetic", version: "unit-v1" });
  calls.rerankerConfigured.mockReset().mockResolvedValue(true);
  calls.rerank.mockReset().mockResolvedValue({ model: "synthetic", provider: "synthetic", results: [{ id: candidate.id, reason: "synthetic", score: 0.9 }] });
  calls.semantic.mockReset().mockResolvedValue([candidate]);
  calls.keyword.mockReset().mockResolvedValue([]);
});

describe("matching cancellation does not become an ordinary degradation", () => {
  it("does not replace an embedding control error with keyword matching", async () => {
    const { ctx } = execution();
    const stopped = new GenerationExecutionStopped("obsolete");
    calls.embedding.mockRejectedValueOnce(stopped);
    const warn = vi.fn();
    await expect(runWithGenerationExecution(ctx, () => findSameFrequencyMatches({ ...input, logger: { info: vi.fn(), error: vi.fn(), warn } }))).rejects.toBe(stopped);
    expect(calls.keyword).not.toHaveBeenCalled();
    expect(calls.semantic).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not replace a reranker control error with semantic-score or keyword fallback", async () => {
    const { ctx } = execution();
    const stopped = new GenerationExecutionStopped("shutdown");
    calls.rerank.mockRejectedValueOnce(stopped);
    const warn = vi.fn();
    await expect(runWithGenerationExecution(ctx, () => findSameFrequencyMatches({ ...input, logger: { info: vi.fn(), error: vi.fn(), warn } }))).rejects.toBe(stopped);
    expect(calls.keyword).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still degrades an ordinary reranker failure while its owning execution remains active", async () => {
    const { ctx } = execution();
    calls.rerank.mockRejectedValueOnce(new Error("ordinary synthetic provider failure"));
    const warn = vi.fn();
    const result = await runWithGenerationExecution(ctx, () => findSameFrequencyMatches({ ...input, logger: { info: vi.fn(), error: vi.fn(), warn } }));
    expect(result.matches.map((match) => match.id)).toContain(candidate.id);
    expect(calls.keyword).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still tries keyword matching after an ordinary embedding error with no execution scope", async () => {
    calls.embedding.mockRejectedValueOnce(new Error("ordinary synthetic embedding failure"));
    const result = await findSameFrequencyMatches(input);
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.embedding).toBeUndefined();
    expect(calls.keyword).toHaveBeenCalledTimes(1);
  });

  it("checks ownership after an in-flight candidate query before reranking or keyword reads", async () => {
    const { ctx, controller } = execution();
    const queryStarted = deferred();
    const release = deferred();
    calls.semantic.mockImplementationOnce(async () => { queryStarted.resolve(); await release.promise; return [candidate]; });
    const result = runWithGenerationExecution(ctx, () => findSameFrequencyMatches(input));
    const rejected = expect(result).rejects.toMatchObject({ reason: "obsolete" });
    await queryStarted.promise;
    controller.abort(new GenerationExecutionStopped("obsolete"));
    release.resolve();
    await rejected;
    expect(calls.rerank).not.toHaveBeenCalled();
    expect(calls.keyword).not.toHaveBeenCalled();
  });
});
