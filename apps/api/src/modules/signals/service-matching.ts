import { composeMatchScore, cosineRelevance, matchScoreVersion } from "./match-scoring.js";
import { parsePublicationSnapshot } from "./publication.js";
import { assertGenerationActive, throwIfGenerationStopped } from "../../shared/generation-execution.js";
import {
  generateEmbedding,
  type EmbeddingLogger,
  type EmbeddingResult,
  isEmbeddingProviderConfigured,
} from "../ai/embedding.js";
import { isRerankerProviderConfigured, rerankCandidates } from "../ai/reranker.js";
import { normalizeRerankerScore } from "../ai/reranker-adapter.js";
import type { AiSignalSeedClassification } from "../ai/signal-types.js";
import {
  listPublishedSemanticSignalMatchCandidates,
  recheckPublicSignals,
  listPublishedSignalMatchCandidates,
} from "./repository.js";
import { maxMatchCount } from "./service-constants.js";
import { isMatchEligible, matchPolicyVersion, resolveMatchPolicy, type MatchPolicy, type MatchScope } from "./match-policy.js";
import type { AiExecutionMetadata } from "../ai/provider-execution.js";
import { buildSignalEmbeddingText } from "./service-embedding.js";
import { toSafeErrorReason } from "./service-errors.js";
import {
  getFingerprintFrequencyProfile,
  getSignalFrequencyProfile,
  toMatchSummary,
  toSemanticMatchSummary,
} from "./service-mappers.js";
import type {
  SignalFingerprint,
  SignalFrequencyProfile,
  SignalMatchSummary,
  SignalRecord,
  SignalSemanticMatchRecord,
} from "./types.js";

export function scoreSignalMatch(fingerprint: SignalFingerprint, candidate: SignalRecord,
  prepared?: { current: SignalFrequencyProfile; candidate: SignalFrequencyProfile }): number {
  const currentProfile = prepared?.current ?? getFingerprintFrequencyProfile(fingerprint);
  const candidateProfile = prepared?.candidate ?? getSignalFrequencyProfile(candidate);
  let score = 0;

  if (candidateProfile.primaryBand === currentProfile.primaryBand) {
    score += 20;
  }

  if (candidateProfile.subFeeling === currentProfile.subFeeling) {
    score += 10;
  }

  if (
    candidateProfile.emotionTone === currentProfile.emotionTone ||
    candidate.fingerprintJson.primaryEmotion === fingerprint.primaryEmotion
  ) {
    score += 5;
  }

  if (candidateProfile.coreNeed === currentProfile.coreNeed) {
    score += 5;
  }

  return score;
}

type MatchCandidate = { signal: SignalRecord; distance?: number };
export type MatchDiagnostics = {
  policyVersion: string; semanticIds: string[]; poolIds: string[]; rankedIds: string[];
  acceptedCount: number; minScore: number; latencyMs: number; inputCharacters: number;
  embeddingExecution?: AiExecutionMetadata; rerankerExecution?: AiExecutionMetadata;
};
export type MatchInput = {
  classification?: AiSignalSeedClassification; excludeSignalId?: string; excludeAuthorIds?: readonly string[];
  corpusIds?: readonly string[]; publicTags?: readonly string[]; publicBand?: SignalFingerprint["primaryBand"];
  expandedText: string; fingerprint: SignalFingerprint; logger?: EmbeddingLogger;
  rawInput: string; publicQuery?: boolean; policy?: MatchPolicy;
};

async function semanticCandidates(input: MatchInput, scope: MatchScope, policy: MatchPolicy): Promise<{ embedding?: EmbeddingResult; candidates: SignalSemanticMatchRecord[] }> {
  let embedding: EmbeddingResult | undefined;
  try {
    await assertGenerationActive();
    const configured = await isEmbeddingProviderConfigured();
    await assertGenerationActive();
    if (!configured) return { candidates: [] };
    embedding = await generateEmbedding(buildSignalEmbeddingText(input), {
      logger: input.logger, purpose: input.publicQuery ? "public-detail" : "creation",
    });
    await assertGenerationActive();
    const rows = await listPublishedSemanticSignalMatchCandidates(embedding.embedding, policy.semanticCandidates, scope.excludeSignalId, embedding, scope);
    await assertGenerationActive();
    const candidates = rows.filter((row) => isMatchEligible(row, scope) && Number.isFinite(row.distance) && row.distance >= 0 && row.distance <= 2);
    input.logger?.info({ action: "signal.semantic_match.candidates", version: embedding.version,
      candidates: candidates.length, requested: policy.semanticCandidates, legacyVectorsIncluded: false }, "same-space public candidate recall");
    return { embedding, candidates };
  } catch (error) {
    throwIfGenerationStopped(error); await assertGenerationActive();
    input.logger?.warn({ action: "signal.semantic_match.fallback", reason: toSafeErrorReason(error) }, "semantic recall unavailable");
    return { embedding, candidates: [] };
  }
}

function mergeCandidates(semantic: SignalSemanticMatchRecord[], rules: SignalRecord[], scope: MatchScope): MatchCandidate[] {
  const pool = new Map<string, MatchCandidate>();
  const changed = new Set<string>();
  for (const row of [...rules, ...semantic]) {
    if (!isMatchEligible(row, scope) || changed.has(row.id)) continue;
    const previous = pool.get(row.id);
    if (previous !== undefined && previous.signal.publicationVersion !== row.publicationVersion) {
      pool.delete(row.id); changed.add(row.id); continue;
    }
    const distance = "distance" in row && typeof row.distance === "number" ? row.distance : previous?.distance;
    pool.set(row.id, { signal: row, ...(distance === undefined ? {} : { distance }) });
  }
  return [...pool.values()];
}
async function recheckCandidates(pool: MatchCandidate[], scope: MatchScope): Promise<MatchCandidate[]> {
  await assertGenerationActive();
  const current = await recheckPublicSignals(pool.map((entry) => entry.signal));
  await assertGenerationActive();
  return pool.flatMap((entry) => {
    const row = current.find((row) => row.id === entry.signal.id && row.publicationVersion === entry.signal.publicationVersion);
    return row === undefined || !isMatchEligible(row, scope) ? [] : [{ ...entry, signal: row }];
  });
}

async function rankCandidates(pool: MatchCandidate[], input: MatchInput, scope: MatchScope, policy: MatchPolicy): Promise<{
  matches: SignalMatchSummary[]; execution?: AiExecutionMetadata; inputCharacters: number;
}> {
  let active = await recheckCandidates(pool, scope);
  let execution: AiExecutionMetadata | undefined;
  let inputCharacters = 0;
  const score = (entry: MatchCandidate, retrieval: number | undefined,
    reason: "reranker_complete" | "reranker_not_configured" | "reranker_failed"): SignalMatchSummary => ({
    ...(entry.distance === undefined ? toMatchSummary(entry.signal, 0) : toSemanticMatchSummary({ ...entry.signal, distance: entry.distance })),
    score: composeMatchScore(retrieval, scoreSignalMatch(input.fingerprint, entry.signal)),
    scoreProvenance: { version: matchScoreVersion, scale: "zero_to_hundred",
      method: reason === "reranker_complete" ? "reranker" : entry.distance === undefined ? "rules" : "cosine",
      reason: reason !== "reranker_complete" && entry.distance === undefined && reason !== "reranker_failed" ? "rules_only" : reason },
  });
  const fallback = (reason: "reranker_not_configured" | "reranker_failed") => active.map((entry) =>
    score(entry, entry.distance === undefined ? undefined : cosineRelevance(entry.distance), reason));
  if (active.length === 0) return { matches: [], inputCharacters };
  try {
    const configured = await isRerankerProviderConfigured();
    await assertGenerationActive();
    if (!configured) return { matches: fallback("reranker_not_configured"), inputCharacters };
    active = await recheckCandidates(active, scope);
    if (active.length === 0) return { matches: [], inputCharacters };
    const candidates = active.map(({ signal, distance }) => ({ id: signal.id,
      expandedText: parsePublicationSnapshot(signal.publicationSnapshot)!.content.expandedText,
      ...(distance === undefined ? {} : { distance }) }));
    inputCharacters = input.expandedText.length + candidates.reduce((total, candidate) => total + candidate.expandedText.length, 0);
    if (inputCharacters > policy.maxRerankCharacters) {
      input.logger?.warn({ action: "signal.reranker.input_budget", inputCharacters, budget: policy.maxRerankCharacters,
        dispatched: false }, "rerank skipped for the entire oversized batch");
      return { matches: fallback("reranker_failed"), inputCharacters };
    }
    const reranked = await rerankCandidates({ candidates, queryText: input.expandedText }, undefined, { logger: input.logger });
    await assertGenerationActive();
    execution = reranked.execution;
    const byId = new Map(reranked.results.map((result) => [result.id, result.score]));
    if (reranked.scoreScale !== "zero_to_one" || byId.size !== active.length || reranked.results.length !== active.length ||
        reranked.results.some((result) => normalizeRerankerScore(result.rawScore, result.rawScale) !== result.score) ||
        active.some(({ signal }) => { const value = byId.get(signal.id); return value === undefined || !Number.isFinite(value) || value < 0 || value > 1; })) {
      throw new Error("Incomplete normalized rerank batch.");
    }
    const matches = active.map((entry) => score(entry, byId.get(entry.signal.id)!, "reranker_complete"));
    const previous = active.map(({ signal }) => ({ id: signal.id, score: Number((0.6 * reranked.results.find((item) => item.id === signal.id)!.rawScore + scoreSignalMatch(input.fingerprint, signal)).toFixed(4)) }))
      .sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
    input.logger?.info({ action: "signal.match.scoring", version: matchScoreVersion, comparison: "same-pool-e2-formula-only", execution,
      previous, current: [...matches].sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).map(({ id, score }) => ({ id, score })),
      rawScores: reranked.results.map(({ id, rawScore, rawScale, score }) => ({ id, rawScore, rawScale, normalizedScore: score })) }, "same-pool score scale comparison; no quality claim");
    return { matches, execution, inputCharacters };
  } catch (error) {
    throwIfGenerationStopped(error); await assertGenerationActive();
    if (typeof error === "object" && error !== null && "details" in error) execution = (error.details as { execution?: AiExecutionMetadata } | undefined)?.execution;
    input.logger?.warn({ action: "signal.reranker.fallback", reason: toSafeErrorReason(error) }, "whole-batch scoring fallback");
    return { matches: fallback("reranker_failed"), execution, inputCharacters };
  }
}

export async function findSameFrequencyMatches(input: MatchInput): Promise<{ embedding?: EmbeddingResult; matches: SignalMatchSummary[]; diagnostics: MatchDiagnostics }> {
  await assertGenerationActive();
  const startedAt = performance.now();
  const policy = resolveMatchPolicy(input.policy);
  const scope: MatchScope = { excludeSignalId: input.excludeSignalId, excludeAuthorIds: input.excludeAuthorIds,
    corpusIds: input.corpusIds, tags: input.publicQuery ? input.publicTags ?? [] : input.fingerprint.tags,
    band: input.publicQuery ? input.publicBand : input.fingerprint.primaryBand };
  const semantic = await semanticCandidates(input, scope, policy);
  await assertGenerationActive();
  const rules = await listPublishedSignalMatchCandidates(policy.ruleCandidates, scope.excludeSignalId, scope);
  await assertGenerationActive();
  const pool = mergeCandidates(semantic.candidates, rules, scope);
  const ranked = await rankCandidates(pool, input, scope, policy);
  await assertGenerationActive();
  // Recheck the whole pool before selecting the final positions. Withdrawn top
  // candidates may leave fewer results; weak candidates are never added to fill three.
  const current = await recheckCandidates(pool, scope);
  const matches = ranked.matches.filter((match) => match.score > 0 && match.score >= policy.minScore &&
    current.some((entry) => entry.signal.id === match.id && entry.signal.publicationVersion === match.publicationVersion))
    .sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0, maxMatchCount);
  const diagnostics: MatchDiagnostics = { policyVersion: matchPolicyVersion, semanticIds: semantic.candidates.map((row) => row.id),
    poolIds: pool.map(({ signal }) => signal.id), rankedIds: [...ranked.matches].sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).map((match) => match.id), acceptedCount: matches.length,
    minScore: policy.minScore, latencyMs: Math.max(0, performance.now() - startedAt), inputCharacters: ranked.inputCharacters,
    embeddingExecution: semantic.embedding?.execution, rerankerExecution: ranked.execution };
  input.logger?.info({ action: "signal.match.selection", policyVersion: matchPolicyVersion, semanticCandidates: policy.semanticCandidates,
    ruleCandidates: policy.ruleCandidates, minScore: policy.minScore, pooled: pool.length, accepted: matches.length,
    durationMs: diagnostics.latencyMs, contentPolicy: "other-owned-human-initiated" }, "matching policy applied; calibration pending");
  return { embedding: semantic.embedding, matches, diagnostics };
}
