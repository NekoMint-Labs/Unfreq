import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z.string().trim().min(1);
export const seedDatasetSchema = z.object({
  version: text,
  source: z.literal("synthetic-authored-not-user-data"),
  humanValidated: z.literal(false),
  cases: z.array(z.object({ id: text, category: text, seedText: text }).strict()).min(1),
}).strict();
export type SeedDataset = z.infer<typeof seedDatasetSchema>;

// This imports captured evidence. It never invokes a provider or simulates a
// second generation/matching algorithm. Provenance is checked for consistency,
// not cryptographically attested execution of the claimed code path.
export const faithfulnessCaptureSchema = z.object({
  version: z.literal("e4-capture-v1"),
  datasetSha256: sha256,
  codeSha: z.string().regex(/^[a-f0-9]{40}$/u),
  promptSha256: sha256,
  executionPath: z.literal("POST /api/signals -> generation worker"),
  environment: z.enum(["loopback-stub", "external-model"]),
  rawEvidence: z.object({ path: text, sha256 }).strict(),
  records: z.array(z.object({
    caseId: text,
    seedText: text,
    signalId: z.uuid(),
    status: z.enum(["COMPLETED", "FAILED"]),
    outputText: text.nullable(),
    matches: z.array(z.object({ id: text, text }).strict()).max(3),
    provider: text,
    model: text,
    fallback: z.boolean(),
    latencyMs: z.number().finite().nonnegative(),
    tokens: z.number().int().nonnegative().nullable(),
    currencyCost: z.number().finite().nonnegative().nullable(),
    currency: text.nullable(),
  }).strict().superRefine((record, context) => {
    if ((record.status === "COMPLETED") !== (record.outputText !== null)) {
      context.addIssue({ code: "custom", message: "Completion status and output disagree." });
    }
    if (record.status === "FAILED" && record.matches.length > 0) {
      context.addIssue({ code: "custom", message: "Failed records cannot have matches." });
    }
    if (record.currencyCost !== null && record.currency === null) {
      context.addIssue({ code: "custom", message: "Known cost requires a currency." });
    }
  })).min(1),
}).strict();
export type FaithfulnessCapture = z.infer<typeof faithfulnessCaptureSchema>;

export function evaluationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function distinct(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
}

export function validateFaithfulnessCapture(dataset: SeedDataset, datasetHash: string, value: unknown) {
  seedDatasetSchema.parse(dataset);
  distinct(dataset.cases.map((item) => item.id), "dataset IDs");
  const capture = faithfulnessCaptureSchema.parse(value);
  if (capture.datasetSha256 !== datasetHash) throw new Error("Dataset hash mismatch.");
  distinct(capture.records.map((item) => item.caseId), "capture IDs");
  distinct(capture.records.map((item) => item.signalId), "signal IDs");
  const cases = new Map(dataset.cases.map((item) => [item.id, item]));
  for (const record of capture.records) {
    if (cases.get(record.caseId)?.seedText !== record.seedText) throw new Error("Unknown or changed captured Seed.");
    distinct(record.matches.map((item) => item.id), "match IDs");
  }
  return capture;
}

type BlindItem = { blindId: string; seedText: string; outputText: string; matches: Array<{ id: string; text: string }> };
export type BlindKey = {
  version: "e4-blind-key-v1";
  captureSha256: string;
  dataset: SeedDataset;
  capture: FaithfulnessCapture;
  items: Array<{ blindId: string; caseId: string; itemSha256: string }>;
};
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function prepareBlindReview(dataset: SeedDataset, datasetHash: string, input: unknown) {
  const capture = validateFaithfulnessCapture(dataset, datasetHash, input);
  const captureSha256 = evaluationHash(capture);
  const items: BlindItem[] = capture.records.filter((record) => record.status === "COMPLETED").map((record) => ({
    blindId: randomUUID(), seedText: record.seedText, outputText: record.outputText!, matches: record.matches,
  }));
  const completed = capture.records.filter((record) => record.status === "COMPLETED");
  const key: BlindKey = { version: "e4-blind-key-v1", captureSha256, dataset, capture,
    items: items.map((item, index) => ({ blindId: item.blindId, caseId: completed[index]!.caseId, itemSha256: evaluationHash(item) })) };
  const sheet = () => ({ version: "e4-review-v1", captureSha256, reviewerId: "", independentReviewConfirmed: false,
    items: shuffle(items).map((item) => ({ ...item, faithfulness: null, fabrication: null, forcedNegative: null, matchRelevance: null, comment: "" })) });
  return { key, reviewerA: sheet(), reviewerB: sheet() };
}

const score = z.number().int().min(1).max(5);
const reviewSchema = z.object({
  version: z.literal("e4-review-v1"), captureSha256: sha256, reviewerId: text,
  independentReviewConfirmed: z.literal(true),
  items: z.array(z.object({
    blindId: z.uuid(), seedText: text, outputText: text,
    matches: z.array(z.object({ id: text, text }).strict()).max(3),
    faithfulness: score, fabrication: z.boolean(), forcedNegative: z.boolean(),
    matchRelevance: score.nullable(), comment: z.string(),
  }).strict()),
}).strict();

function percentile(values: number[], proportion: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(proportion * sorted.length) - 1)]!;
}

export function summarizeBlindReview(key: BlindKey, first: unknown, second: unknown) {
  const dataset = seedDatasetSchema.parse(key.dataset);
  const capture = validateFaithfulnessCapture(dataset, key.capture.datasetSha256, key.capture);
  if (key.version !== "e4-blind-key-v1" || key.captureSha256 !== evaluationHash(capture)) throw new Error("Invalid blind key.");
  distinct(key.items.map((item) => item.blindId), "blind IDs");
  distinct(key.items.map((item) => item.caseId), "blind case IDs");
  const completed = capture.records.filter((record) => record.status === "COMPLETED");
  if (key.items.length !== completed.length || completed.some((record) => !key.items.some((item) => item.caseId === record.caseId))) {
    throw new Error("Blind key must cover every completed record.");
  }
  const sheets = [reviewSchema.parse(first), reviewSchema.parse(second)];
  if (sheets[0]!.reviewerId === sheets[1]!.reviewerId) throw new Error("Two distinct independent reviewers are required.");
  for (const sheet of sheets) {
    if (sheet.captureSha256 !== key.captureSha256 || sheet.items.length !== key.items.length) throw new Error("Incomplete or mismatched review.");
    distinct(sheet.items.map((item) => item.blindId), "review IDs");
    for (const item of sheet.items) {
      const { blindId, seedText, outputText, matches } = item;
      const expected = key.items.find((entry) => entry.blindId === blindId);
      const record = capture.records.find((entry) => entry.caseId === expected?.caseId);
      if (expected?.itemSha256 !== evaluationHash({ blindId, seedText, outputText, matches }) ||
          record?.seedText !== seedText || record.outputText !== outputText || evaluationHash(record.matches) !== evaluationHash(matches)) {
        throw new Error("Blind item content or mapping changed.");
      }
      if ((matches.length === 0) !== (item.matchRelevance === null)) throw new Error("Relevance needs matches; no-match relevance must remain null.");
    }
  }
  const ratings = sheets.flatMap((sheet) => sheet.items);
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  const disagreements = sheets[0]!.items.filter((item) => {
    const other = sheets[1]!.items.find((entry) => entry.blindId === item.blindId)!;
    return Math.abs(item.faithfulness - other.faithfulness) > 1 || item.fabrication !== other.fabrication ||
      item.forcedNegative !== other.forcedNegative || Math.abs((item.matchRelevance ?? 0) - (other.matchRelevance ?? 0)) > 1;
  }).map((item) => item.blindId);
  const costs = capture.records.map((record) => record.currencyCost);
  const currencies = new Set(capture.records.map((record) => record.currency));
  return {
    version: "e4-review-summary-v1", captureSha256: key.captureSha256,
    dataset: { version: dataset.version, source: dataset.source, humanValidated: dataset.humanValidated },
    datasetSha256: capture.datasetSha256, codeSha: capture.codeSha, promptSha256: capture.promptSha256,
    environment: capture.environment, provenanceVerification: "consistency-only-not-execution-attestation",
    modelQualityValidated: false, competitionEvidenceEligible: false,
    authorApproval: null, ablations: "NOT_RUN",
    coverage: { dataset: dataset.cases.length, captured: capture.records.length, completed: completed.length,
      failed: capture.records.length - completed.length, fallback: capture.records.filter((record) => record.fallback).length,
      rated: completed.length, ratings: ratings.length },
    humanRatings: { faithfulnessMean: mean(ratings.map((item) => item.faithfulness)),
      fabricationRate: mean(ratings.map((item) => Number(item.fabrication))),
      forcedNegativeRate: mean(ratings.map((item) => Number(item.forcedNegative))),
      matchRelevanceMean: mean(ratings.flatMap((item) => item.matchRelevance === null ? [] : [item.matchRelevance])),
      disagreements },
    latencyMs: { p50: percentile(capture.records.map((item) => item.latencyMs), 0.5), p95: percentile(capture.records.map((item) => item.latencyMs), 0.95) },
    currencyCost: costs.some((cost) => cost === null) || currencies.size !== 1 ? null : costs.reduce<number>((sum, cost) => sum + cost!, 0),
    currency: currencies.size === 1 ? capture.records[0]!.currency : null,
  };
}
