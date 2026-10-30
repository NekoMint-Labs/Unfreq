import { confirmUnitPublication } from "../../../tests/unit/publication-fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureFingerprint } from "../../../tests/integration/fixtures.js";
import { findSameFrequencyMatches, scoreSignalMatch } from "./service-matching.js";
import type { SignalSemanticMatchRecord } from "./types.js";
const state = vi.hoisted(() => ({ scores: [] as { id: string; score: number }[], scale: "zero_to_one", configured: true }));
const calls = vi.hoisted(() => ({ semantic: vi.fn(), keyword: vi.fn(), recheck: vi.fn() }));
vi.mock("../ai/provider-config.js", () => ({
  resolveRerankerProviderConfig: async () => ({ apiKey: "synthetic-secret", baseUrl: "https://rerank.invalid/v1", model: "synthetic", provider: "generic", scoreScale: state.scale }),
  resolveRerankerProviderConfigs: async () => state.configured ? [{ apiKey: "synthetic-secret", baseUrl: "https://rerank.invalid/v1", model: "synthetic", provider: "generic", scoreScale: state.scale }] : [],
}));
vi.mock("../ai/embedding.js", () => ({ isEmbeddingProviderConfigured: async () => true,
  generateEmbedding: async () => ({ embedding: [1,2,3], dimensions: 3, model: "synthetic", provider: "synthetic", version: "es1:"+"a".repeat(64) }) }));
vi.mock("./repository.js", () => ({ listPublishedSemanticSignalMatchCandidates: calls.semantic,
  listPublishedSignalMatchCandidates: calls.keyword, recheckPublicSignals: calls.recheck }));
const candidate: SignalSemanticMatchRecord = confirmUnitPublication({
  publicationVersion: 0, publicationSnapshot: null, withdrawnAt: null, audioPublicationVersion: null,
  id: "synthetic-candidate", authorId: "00000000-0000-4000-8000-000000000101", authorFreqCode: "FM-10.01", frequencyId: null,
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
});
const rows = [{ ...candidate, id: "candidate-a", distance: 0.2 }, { ...candidate, id: "candidate-b", distance: 0.5 }];
const input = { expandedText: "synthetic public query", rawInput: "PRIVATE-SEED", fingerprint: fixtureFingerprint, publicQuery: true };
beforeEach(() => {
  vi.unstubAllGlobals(); state.scale = "zero_to_one"; state.configured = true;
  calls.semantic.mockReset().mockResolvedValue(rows); calls.keyword.mockReset().mockResolvedValue([]);
  calls.recheck.mockReset().mockImplementation(async (observed: { id: string }[]) => observed.flatMap((item) => rows.filter((row) => row.id === item.id)));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: state.scores }), { status: 200 })));
});
describe("E2 score contract through transport and matching", () => {
  it("treats a declared 0–1 score as the same relevance as its 0–100 equivalent", async () => {
    state.scores = [{ id: rows[0].id, score: 0.9 }, { id: rows[1].id, score: 0.2 }];
    const result = await findSameFrequencyMatches(input);
    expect(result.matches.map((match) => match.score)).toEqual([54 + scoreSignalMatch(fixtureFingerprint, rows[0]), 12 + scoreSignalMatch(fixtureFingerprint, rows[1])]);
    state.scale = "zero_to_hundred"; state.scores = [{ id: rows[0].id, score: 90 }, { id: rows[1].id, score: 20 }];
    expect((await findSameFrequencyMatches(input)).matches.map((match) => [match.id, match.score])).toEqual(result.matches.map((match) => [match.id, match.score]));
  });
  it("falls back for the entire candidate set when one id has no score", async () => {
    state.scores = [{ id: rows[0].id, score: 0.9 }];
    const result = await findSameFrequencyMatches(input);
    expect(result.matches.map((match) => [match.id, match.score])).toEqual([
      [rows[0].id, 50 + scoreSignalMatch(fixtureFingerprint, rows[0])], [rows[1].id, 40 + scoreSignalMatch(fixtureFingerprint, rows[1])],
    ]);
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 80])("falls back consistently for an invalid score %s", async (score) => {
    state.scores = [{ id: rows[0].id, score }, { id: rows[1].id, score: 0.8 }];
    const result = await findSameFrequencyMatches(input);
    expect(result.matches.map((match) => match.score)).toEqual([90, 80]);
    expect(result.matches.every((match) => match.scoreProvenance?.method === "cosine" && match.scoreProvenance.reason === "reranker_failed")).toBe(true);
  });
  it("keeps ordering deterministic regardless of response order", async () => {
    state.scores = [{ id: rows[0].id, score: 0.8 }, { id: rows[1].id, score: 0.8 }];
    const first = (await findSameFrequencyMatches(input)).matches.map(({ id, score }) => ({ id, score }));
    state.scores.reverse();
    expect((await findSameFrequencyMatches(input)).matches.map(({ id, score }) => ({ id, score }))).toEqual(first);
    expect(first.map(({ id }) => id)).toEqual(["candidate-a", "candidate-b"]);
  });
  it("removes the accidental rule dominance caused by unit-interval raw scores", async () => {
    const different: SignalSemanticMatchRecord = { ...rows[0], primaryBand: "relationship_nebula", subFeeling: "need_to_be_understood",
      emotionTone: "different", coreNeed: "different", fingerprintJson: { ...fixtureFingerprint, primaryEmotion: "different" } };
    expect(scoreSignalMatch(fixtureFingerprint, different)).toBe(0);
    calls.semantic.mockResolvedValue([different, rows[1]]);
    state.scores = [{ id: rows[0].id, score: 0.9 }, { id: rows[1].id, score: 0.2 }];
    const info = vi.fn();
    const result = await findSameFrequencyMatches({ ...input, logger: { info, warn: vi.fn(), error: vi.fn() } });
    expect(result.matches.map(({ id, score }) => [id, score])).toEqual([["candidate-a", 54], ["candidate-b", 52]]);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ action: "signal.match.scoring",
      previous: [{ id: "candidate-b", score: 40.12 }, { id: "candidate-a", score: 0.54 }],
    }), expect.any(String));
  });
  it("records old/new ranks and safe accounting without the private query or Provider payload", async () => {
    state.scores = [{ id: rows[0].id, score: 0.9 }, { id: rows[1].id, score: 0.2 }];
    const info = vi.fn();
    await findSameFrequencyMatches({ ...input, logger: { info, warn: vi.fn(), error: vi.fn() } });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ action: "signal.match.scoring",
      previous: [{ id: "candidate-a", score: 40.54 }, { id: "candidate-b", score: 40.12 }],
      current: [{ id: "candidate-a", score: 94 }, { id: "candidate-b", score: 52 }],
      execution: expect.objectContaining({ cost: "unknown", attempts: [expect.objectContaining({ outcome: "SUCCEEDED" })] }),
    }), expect.any(String));
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE-SEED|synthetic public query|synthetic-secret|rerank.invalid/u);
  });
  it("uses the same cosine fallback for HTTP failure and disabled reranking", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const failed = await findSameFrequencyMatches(input);
    state.configured = false;
    const disabled = await findSameFrequencyMatches(input);
    expect(failed.matches.map((match) => match.score)).toEqual(disabled.matches.map((match) => match.score));
    expect(disabled.matches[0].scoreProvenance?.reason).toBe("reranker_not_configured");
  });
  it("settles an HTTP timeout as one uniform fallback batch", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const received = new Promise<void>((resolve) => { started = resolve; });
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("synthetic timeout", "AbortError")), { once: true }); started();
    }));
    vi.stubGlobal("fetch", fetch);
    try {
      const work = findSameFrequencyMatches(input);
      await received; await vi.advanceTimersByTimeAsync(5000);
      expect((await work).matches.map((match) => match.score)).toEqual([90, 80]);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
