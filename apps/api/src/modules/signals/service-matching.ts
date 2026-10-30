import { composeMatchScore, cosineRelevance, matchScoreVersion } from "./match-scoring.js";
import { isPublicSignal } from "./publication-policy.js";
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
import { matchCandidateLimit, maxMatchCount } from "./service-constants.js";
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

async function findKeywordSameFrequencyMatches(
  fingerprint: SignalFingerprint,
  options: {
    excludeSignalId?: string;
  } = {},
): Promise<SignalMatchSummary[]> {
  await assertGenerationActive();
  const publishedCandidates = await listPublishedSignalMatchCandidates(
    matchCandidateLimit,
    options.excludeSignalId,
  );
  await assertGenerationActive();
  const publishedMatches = publishedCandidates
    .filter((candidate) => candidate.id !== options.excludeSignalId && isPublicSignal(candidate))
    .map<SignalMatchSummary>((candidate) => ({ ...toMatchSummary(candidate, composeMatchScore(undefined, scoreSignalMatch(fingerprint, candidate))),
      scoreProvenance: { version: matchScoreVersion, scale: "zero_to_hundred" as const, method: "rules" as const, reason: "rules_only" as const } }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, maxMatchCount);

  return publishedMatches;
}

async function rerankSemanticMatches(params: {
  candidates: SignalSemanticMatchRecord[];
  expandedText: string;
  fingerprint: SignalFingerprint;
  logger?: EmbeddingLogger;
}): Promise<SignalMatchSummary[]> {
  await assertGenerationActive();
  const applyScore = (candidate: SignalSemanticMatchRecord, retrieval: number,
    method: "cosine" | "reranker", reason: "reranker_complete" | "reranker_not_configured" | "reranker_failed"): SignalMatchSummary => ({
    ...toSemanticMatchSummary(candidate),
    score: composeMatchScore(retrieval, scoreSignalMatch(params.fingerprint, candidate)),
    scoreProvenance: { version: matchScoreVersion, scale: "zero_to_hundred" as const, method, reason },
  });
  const sorted = (matches: SignalMatchSummary[]) => matches.sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
  const cosineFallback = (reason: "reranker_not_configured" | "reranker_failed") => sorted(params.candidates.map((candidate) =>
    applyScore(candidate, cosineRelevance(candidate.distance), "cosine", reason)));

  const observed = params.candidates;
  const current = await recheckPublicSignals(observed);
  params.candidates = observed.filter((candidate) => current.some((row) => row.id === candidate.id));
  const configured = await isRerankerProviderConfigured();
  await assertGenerationActive();
  if (!configured) {
    return cosineFallback("reranker_not_configured");
  }

  try {
    const latest = await recheckPublicSignals(params.candidates);
    params.candidates = params.candidates.filter((candidate) => latest.some((row) => row.id === candidate.id));
    await assertGenerationActive();
    if (params.candidates.length === 0) return [];
    const reranked = await rerankCandidates({
      candidates: params.candidates.map((candidate) => {
        return {
          distance: candidate.distance,
          expandedText: parsePublicationSnapshot(candidate.publicationSnapshot)!.content.expandedText,
          id: candidate.id,
        };
      }),
      queryText: params.expandedText,
    }, undefined, { logger: params.logger });
    await assertGenerationActive();
    const scoreById = new Map(reranked.results.map((result) => [result.id, result.score]));
    // Defence in depth: a mocked/older adapter must not reintroduce per-ID mixing.
    if (reranked.scoreScale !== "zero_to_one" || scoreById.size !== params.candidates.length || reranked.results.length !== params.candidates.length ||
        reranked.results.some((result) => normalizeRerankerScore(result.rawScore, result.rawScale) !== result.score) ||
        params.candidates.some((candidate) => { const score = scoreById.get(candidate.id); return score === undefined || !Number.isFinite(score) || score < 0 || score > 1; })) {
      throw new Error("Incomplete normalized rerank batch.");
    }
    const matches = sorted(params.candidates.map((candidate) => applyScore(candidate, scoreById.get(candidate.id)!, "reranker", "reranker_complete")));
    const legacy = params.candidates.map((candidate) => {
      const result = reranked.results.find((item) => item.id === candidate.id)!;
      return { id: candidate.id, score: Number((0.6 * result.rawScore + scoreSignalMatch(params.fingerprint, candidate)).toFixed(4)) };
    }).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
    params.logger?.info({ action: "signal.match.scoring", version: matchScoreVersion, execution: reranked.execution,
      previous: legacy, current: matches.map((match) => ({ id: match.id, score: match.score })),
      rawScores: reranked.results.map(({ id, rawScore, rawScale, score }) => ({ id, rawScore, rawScale, normalizedScore: score })) }, "match score scale comparison; no quality claim");
    return matches;
  } catch (error) {
    throwIfGenerationStopped(error);
    await assertGenerationActive();
    params.logger?.warn(
      {
        action: "signal.reranker.fallback",
        reason: toSafeErrorReason(error),
        targetType: "SIGNAL",
      },
      "signal reranker fell back",
    );

    return cosineFallback("reranker_failed");
  }
}

async function findSemanticSameFrequencyMatches(params: {
  classification?: AiSignalSeedClassification;
  excludeSignalId?: string;
  expandedText: string;
  fingerprint: SignalFingerprint;
  logger?: EmbeddingLogger;
  rawInput: string;
  publicQuery?: boolean;
}): Promise<{ embedding: EmbeddingResult; matches: SignalMatchSummary[] } | undefined> {
  await assertGenerationActive();
  const configured = await isEmbeddingProviderConfigured();
  await assertGenerationActive();
  if (!configured) {
    return undefined;
  }

  try {
    const embedding = await generateEmbedding(
      buildSignalEmbeddingText({
        classification: params.classification,
        expandedText: params.expandedText,
        fingerprint: params.fingerprint,
        seedText: params.rawInput,
      }),
      {
        logger: params.logger,
        purpose: params.publicQuery ? "public-detail" : "creation",
      },
    );
    await assertGenerationActive();
    const semanticCandidates = await listPublishedSemanticSignalMatchCandidates(
      embedding.embedding,
      maxMatchCount,
      params.excludeSignalId,
      embedding,
    );
    await assertGenerationActive();
    const eligible = semanticCandidates.filter((candidate) => isPublicSignal(candidate) && Number.isFinite(candidate.distance) && candidate.distance >= 0 && candidate.distance <= 2);
    params.logger?.info({ action: "signal.semantic_match.candidates", purpose: params.publicQuery ? "public-detail" : "creation",
      version: embedding.version, provider: embedding.provider, model: embedding.model,
      dimensions: embedding.dimensions, candidates: eligible.length, legacyVectorsIncluded: false }, "semantic candidates selected within one embedding space");
    const matches = await rerankSemanticMatches({
      candidates: eligible,
      expandedText: params.expandedText,
      fingerprint: params.fingerprint,
      logger: params.logger,
    });
    await assertGenerationActive();

    const rankedMatches = matches
      .filter((candidate) => candidate.id !== params.excludeSignalId)
      .slice(0, maxMatchCount);

    return {
      embedding,
      matches: rankedMatches,
    };
  } catch (error) {
    throwIfGenerationStopped(error);
    await assertGenerationActive();
    params.logger?.warn(
      {
        action: "signal.semantic_match.fallback",
        reason: toSafeErrorReason(error),
        targetType: "SIGNAL",
      },
      "signal semantic matching fell back",
    );

    return undefined;
  }
}

export async function findSameFrequencyMatches(params: {
  classification?: AiSignalSeedClassification;
  excludeSignalId?: string;
  expandedText: string;
  fingerprint: SignalFingerprint;
  logger?: EmbeddingLogger;
  rawInput: string;
  publicQuery?: boolean;
}): Promise<{ embedding?: EmbeddingResult; matches: SignalMatchSummary[] }> {
  await assertGenerationActive();
  const semanticResult = await findSemanticSameFrequencyMatches(params);
  await assertGenerationActive();
  const keywordMatches = await findKeywordSameFrequencyMatches(params.fingerprint, {
    excludeSignalId: params.excludeSignalId,
  });
  await assertGenerationActive();

  if (semanticResult === undefined || semanticResult.matches.length === 0) {
    const current = await recheckPublicSignals(keywordMatches.flatMap((match) => match.publicationVersion === undefined ? [] : [{ id: match.id, publicationVersion: match.publicationVersion }]));
    return { embedding: semanticResult?.embedding, matches: keywordMatches.filter((match) => current.some((row) => row.id === match.id)) };
  }

  const existingIds = new Set(semanticResult.matches.map((match) => match.id));
  const matches = [
    ...semanticResult.matches,
    ...keywordMatches.filter((match) => !existingIds.has(match.id)),
  ].slice(0, maxMatchCount);

  const current = await recheckPublicSignals(matches.flatMap((match) => match.publicationVersion === undefined ? [] : [{ id: match.id, publicationVersion: match.publicationVersion }]));
  return { embedding: semanticResult.embedding, matches: matches.filter((match) => current.some((row) => row.id === match.id)) };
}
