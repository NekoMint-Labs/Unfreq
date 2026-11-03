import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluationHash, prepareBlindReview, seedDatasetSchema, summarizeBlindReview, validateFaithfulnessCapture, type FaithfulnessCapture } from "./faithfulness-evaluation.js";

const bytes = readFileSync(new URL("../../../tests/fixtures/e4-seeds.v1.json", import.meta.url));
const datasetHash = createHash("sha256").update(bytes).digest("hex");
const dataset = seedDatasetSchema.parse(JSON.parse(bytes.toString()) as unknown);
const capture: FaithfulnessCapture = {
  version: "e4-capture-v1", datasetSha256: datasetHash, codeSha: "a".repeat(40), promptSha256: "b".repeat(64),
  executionPath: "POST /api/signals -> generation worker", environment: "loopback-stub",
  rawEvidence: { path: "synthetic-raw.json", sha256: "c".repeat(64) },
  records: [
    { caseId: dataset.cases[0]!.id, seedText: dataset.cases[0]!.seedText,
      signalId: "00000000-0000-4000-8000-000000000001", status: "COMPLETED", outputText: "测试输出，绝非真人评分。",
      matches: [{ id: "match-one", text: "合成候选" }], provider: "stub", model: "preset", fallback: false,
      latencyMs: 10, tokens: null, currencyCost: null, currency: null },
    { caseId: dataset.cases[1]!.id, seedText: dataset.cases[1]!.seedText,
      signalId: "00000000-0000-4000-8000-000000000002", status: "FAILED", outputText: null,
      matches: [], provider: "stub", model: "preset", fallback: true,
      latencyMs: 100, tokens: null, currencyCost: null, currency: null },
  ],
};
function rated(packet: ReturnType<typeof prepareBlindReview>, reviewerId: string, faithfulness = 4) {
  return { ...structuredClone(packet.reviewerA), reviewerId, independentReviewConfirmed: true,
    items: packet.reviewerA.items.map((item) => ({ ...item, faithfulness, fabrication: false, forcedNegative: false,
      matchRelevance: item.matches.length === 0 ? null : 3 })) };
}

describe("offline faithfulness review evidence", () => {
  it("freezes 60 synthetic Seeds across ten categories without human labels", () => {
    expect(datasetHash).toBe(readFileSync(new URL("../../../tests/fixtures/e4-seeds.v1.sha256", import.meta.url), "utf8").trim());
    expect(dataset.cases).toHaveLength(60);
    expect(new Set(dataset.cases.map((item) => item.id)).size).toBe(60);
    expect(new Set(dataset.cases.map((item) => item.category)).size).toBe(10);
    expect(dataset.humanValidated).toBe(false);
  });
  it("refuses changed data, duplicate records, fake completion and unknown input", () => {
    expect(() => validateFaithfulnessCapture(dataset, "f".repeat(64), capture)).toThrow();
    expect(() => validateFaithfulnessCapture(dataset, datasetHash, { ...capture, records: [capture.records[0], capture.records[0]] })).toThrow();
    expect(() => validateFaithfulnessCapture(dataset, datasetHash, { ...capture, records: [{ ...capture.records[0], seedText: "changed" }] })).toThrow();
    expect(() => validateFaithfulnessCapture(dataset, datasetHash, { ...capture, records: [{ ...capture.records[0], outputText: null }] })).toThrow();
  });
  it("leaves ratings empty and hides provider, category, fallback and source IDs from both reviewers", () => {
    const packet = prepareBlindReview(dataset, datasetHash, capture);
    expect(packet.reviewerA.items).toHaveLength(1);
    expect(packet.reviewerA.items[0]).toMatchObject({ faithfulness: null, fabrication: null, forcedNegative: null });
    for (const sheet of [packet.reviewerA, packet.reviewerB]) {
      expect(sheet.independentReviewConfirmed).toBe(false);
      expect(sheet.reviewerId).toBe("");
      expect(JSON.stringify(sheet)).not.toMatch(/joy-01|provider|preset|fallback|category|codeSha/u);
    }
  });
  it("requires two complete independent reviews bound to exactly the captured outputs", () => {
    const packet = prepareBlindReview(dataset, datasetHash, capture);
    const first = rated(packet, "synthetic-reviewer-a");
    const second = rated(packet, "synthetic-reviewer-b");
    expect(() => summarizeBlindReview(packet.key, packet.reviewerA, second)).toThrow();
    expect(() => summarizeBlindReview(packet.key, first, first)).toThrow();
    expect(() => summarizeBlindReview(packet.key, first, { ...second, items: [] })).toThrow();
    expect(() => summarizeBlindReview(packet.key, first, { ...second, items: [{ ...second.items[0], outputText: "changed" }] })).toThrow();
    expect(() => summarizeBlindReview({ ...packet.key, captureSha256: evaluationHash({}) }, first, second)).toThrow();
    const duplicate = structuredClone(packet.key);
    duplicate.capture.records.push(duplicate.capture.records[1]!);
    duplicate.captureSha256 = evaluationHash(duplicate.capture);
    expect(() => summarizeBlindReview(duplicate, { ...first, captureSha256: duplicate.captureSha256 },
      { ...second, captureSha256: duplicate.captureSha256 })).toThrow("Duplicate capture IDs");
  });
  it("reports coverage, failures, disagreement and unknown costs without approving quality or inventing author acceptance", () => {
    const packet = prepareBlindReview(dataset, datasetHash, capture);
    const result = summarizeBlindReview(packet.key, rated(packet, "synthetic-a", 5), rated(packet, "synthetic-b", 2));
    expect(result).toMatchObject({ modelQualityValidated: false, competitionEvidenceEligible: false,
      authorApproval: null, ablations: "NOT_RUN", currencyCost: null,
      dataset: { version: "e4-seeds-synthetic-v1", source: "synthetic-authored-not-user-data", humanValidated: false },
      coverage: { dataset: 60, captured: 2, completed: 1, failed: 1, fallback: 1, rated: 1, ratings: 2 },
      latencyMs: { p50: 10, p95: 100 }, humanRatings: { faithfulnessMean: 3.5 } });
    expect(result.humanRatings.disagreements).toHaveLength(1);
  });
  it("does not assign matching relevance to empty results", () => {
    const empty = structuredClone(capture);
    empty.records[0]!.matches = [];
    const packet = prepareBlindReview(dataset, datasetHash, empty);
    const first = rated(packet, "synthetic-a");
    const second = rated(packet, "synthetic-b");
    expect(summarizeBlindReview(packet.key, first, second).humanRatings.matchRelevanceMean).toBeNull();
    first.items[0]!.matchRelevance = 5;
    expect(() => summarizeBlindReview(packet.key, first, second)).toThrow();
  });
});
