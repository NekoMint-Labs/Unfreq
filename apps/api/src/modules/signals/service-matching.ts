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
    .map((candidate) => toMatchSummary(candidate, scoreSignalMatch(fingerprint, candidate)))
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
  const applyFrequencyScore = (match: SignalMatchSummary, candidate: SignalRecord) => {
    const semanticScore = match.score;
    const frequencyScore = scoreSignalMatch(params.fingerprint, candidate);

    return {
      ...match,
      score: Number(((semanticScore * 0.6) + frequencyScore).toFixed(4)),
    };
  };

  const observed = params.candidates;
  const current = await recheckPublicSignals(observed);
  params.candidates = observed.filter((candidate) => current.some((row) => row.id === candidate.id));
  const configured = await isRerankerProviderConfigured();
  await assertGenerationActive();
  if (!configured) {
    return params.candidates
      .map((candidate) => applyFrequencyScore(toSemanticMatchSummary(candidate), candidate))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.id.localeCompare(right.id);
      });
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
    });
    await assertGenerationActive();
    const scoreById = new Map(
      reranked.results.map((result) => {
        return [result.id, result.score];
      }),
    );

    return params.candidates
      .map((candidate) => {
        const fallback = toSemanticMatchSummary(candidate);
        const score = scoreById.get(candidate.id);
        const match = {
          ...fallback,
          score: score === undefined ? fallback.score : Number(score.toFixed(4)),
        };

        return applyFrequencyScore(match, candidate);
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.id.localeCompare(right.id);
      });
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

    return params.candidates
      .map((candidate) => applyFrequencyScore(toSemanticMatchSummary(candidate), candidate))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.id.localeCompare(right.id);
      });
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
      params.publicQuery ? params.expandedText : buildSignalEmbeddingText({
        classification: params.classification,
        expandedText: params.expandedText,
        fingerprint: params.fingerprint,
        seedText: params.rawInput,
      }),
      {
        logger: params.logger,
      },
    );
    await assertGenerationActive();
    const semanticCandidates = await listPublishedSemanticSignalMatchCandidates(
      embedding.embedding,
      maxMatchCount,
      params.excludeSignalId,
      embedding.version,
    );
    await assertGenerationActive();
    const eligible = semanticCandidates.filter(isPublicSignal);
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
    return { matches: keywordMatches.filter((match) => current.some((row) => row.id === match.id)) };
  }

  const existingIds = new Set(semanticResult.matches.map((match) => match.id));
  const matches = [
    ...semanticResult.matches,
    ...keywordMatches.filter((match) => !existingIds.has(match.id)),
  ].slice(0, maxMatchCount);

  const current = await recheckPublicSignals(matches.flatMap((match) => match.publicationVersion === undefined ? [] : [{ id: match.id, publicationVersion: match.publicationVersion }]));
  return { embedding: semanticResult.embedding, matches: matches.filter((match) => current.some((row) => row.id === match.id)) };
}
