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
  SignalMatchSummary,
  SignalRecord,
  SignalSemanticMatchRecord,
} from "./types.js";

const seededSignalMatches: SignalMatchSummary[] = [
  {
    expandedText: "有人在通勤路上反复整理明天的任务，想停下来，又怕自己落后。",
    frequencyProfile: {
      coreNeed: "确认努力是否值得",
      displayText: "时代星群 · 效率焦虑",
      emotionTone: "紧绷疲惫",
      innerConflict: "想停下来，却担心自己被进度落下",
      primaryBand: "era_cluster",
      resonanceKeywords: ["通勤", "任务", "落后"],
      subFeeling: "efficiency_anxiety",
    },
    frequencyCode: "FM 21.07",
    id: "seed-pressure-wave-001",
    primaryEmotion: "压力",
    resonanceCount: 0,
    score: 1,
    seedText: "通勤路上的未完成清单。",
    signalType: "pressure-wave",
    source: "SEEDED",
    summary: "有人在通勤路上反复整理明天的任务，想停下来，又怕自己落后。",
    tags: ["压力", "焦虑", "疲惫"],
    title: "通勤里的未完成清单",
  },
  {
    expandedText: "有人把一整天的沉默留在夜里，希望有个陌生人刚好听见。",
    frequencyProfile: {
      coreNeed: "希望被一个陌生人听见",
      displayText: "关系星云 · 被理解需求",
      emotionTone: "安静孤独",
      innerConflict: "想被理解，又不想主动打扰别人",
      primaryBand: "relationship_nebula",
      resonanceKeywords: ["沉默", "夜里", "听见"],
      subFeeling: "need_to_be_understood",
    },
    frequencyCode: "FM 29.18",
    id: "seed-life-fragment-001",
    primaryEmotion: "孤独",
    resonanceCount: 0,
    score: 1,
    seedText: "夜里还有一个空白座位。",
    signalType: "life-fragment",
    source: "SEEDED",
    summary: "有人把一整天的沉默留在夜里，希望有个陌生人刚好听见。",
    tags: ["孤独", "夜晚", "等待"],
    title: "夜里的空白座位",
  },
  {
    expandedText: "有人没有发出那句问候，只把想念调成很低的音量。",
    frequencyProfile: {
      coreNeed: "确认没有说出口的想念仍然被接住",
      displayText: "关系星云 · 关系失望",
      emotionTone: "低声想念",
      innerConflict: "想靠近对方，却把问候留在了原地",
      primaryBand: "relationship_nebula",
      resonanceKeywords: ["问候", "想念", "未送达"],
      subFeeling: "relationship_disappointment",
    },
    frequencyCode: "FM 24.63",
    id: "seed-missing-echo-001",
    primaryEmotion: "想念",
    resonanceCount: 0,
    score: 1,
    seedText: "那句问候最后没有发出去。",
    signalType: "life-fragment",
    source: "SEEDED",
    summary: "有人没有发出那句问候，只把想念调成很低的音量。",
    tags: ["想念", "迟疑", "未送达"],
    title: "没有发出的问候",
  },
];

export function scoreSignalMatch(fingerprint: SignalFingerprint, candidate: SignalRecord): number {
  const currentProfile = getFingerprintFrequencyProfile(fingerprint);
  const candidateProfile = getSignalFrequencyProfile(candidate);
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

function scoreSeededMatch(fingerprint: SignalFingerprint, candidate: SignalMatchSummary): number {
  const currentProfile = getFingerprintFrequencyProfile(fingerprint);
  let score = 0;

  if (candidate.frequencyProfile.primaryBand === currentProfile.primaryBand) {
    score += 20;
  }

  if (candidate.frequencyProfile.subFeeling === currentProfile.subFeeling) {
    score += 10;
  }

  if (
    candidate.frequencyProfile.emotionTone === currentProfile.emotionTone ||
    candidate.primaryEmotion === fingerprint.primaryEmotion
  ) {
    score += 5;
  }

  if (candidate.frequencyProfile.coreNeed === currentProfile.coreNeed) {
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
  const publishedCandidates = await listPublishedSignalMatchCandidates(
    matchCandidateLimit,
    options.excludeSignalId,
  );
  const publishedMatches = publishedCandidates
    .filter((candidate) => candidate.id !== options.excludeSignalId)
    .map((candidate) => toMatchSummary(candidate, scoreSignalMatch(fingerprint, candidate)))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, maxMatchCount);

  if (publishedMatches.length >= maxMatchCount) {
    return publishedMatches;
  }

  const existingIds = new Set(publishedMatches.map((match) => match.id));
  const seededMatches = seededSignalMatches
    .map((candidate) => ({
      ...candidate,
      score: scoreSeededMatch(fingerprint, candidate),
    }))
    .filter((candidate) => candidate.score > 0 && !existingIds.has(candidate.id))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.id.localeCompare(right.id);
    });

  return [...publishedMatches, ...seededMatches].slice(0, maxMatchCount);
}

async function rerankSemanticMatches(params: {
  candidates: SignalSemanticMatchRecord[];
  expandedText: string;
  fingerprint: SignalFingerprint;
  logger?: EmbeddingLogger;
}): Promise<SignalMatchSummary[]> {
  const applyFrequencyScore = (match: SignalMatchSummary, candidate: SignalRecord) => {
    const semanticScore = match.score;
    const frequencyScore = scoreSignalMatch(params.fingerprint, candidate);

    return {
      ...match,
      score: Number(((semanticScore * 0.6) + frequencyScore).toFixed(4)),
    };
  };

  if (!(await isRerankerProviderConfigured())) {
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
    const reranked = await rerankCandidates({
      candidates: params.candidates.map((candidate) => {
        return {
          distance: candidate.distance,
          expandedText: candidate.expandedText,
          id: candidate.id,
        };
      }),
      queryText: params.expandedText,
    });
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
}): Promise<{ embedding: EmbeddingResult; matches: SignalMatchSummary[] } | undefined> {
  if (!(await isEmbeddingProviderConfigured())) {
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
      },
    );
    const semanticCandidates = await listPublishedSemanticSignalMatchCandidates(
      embedding.embedding,
      maxMatchCount,
      params.excludeSignalId,
      embedding.version,
    );
    const matches = await rerankSemanticMatches({
      candidates: semanticCandidates,
      expandedText: params.expandedText,
      fingerprint: params.fingerprint,
      logger: params.logger,
    });

    const rankedMatches = matches
      .filter((candidate) => candidate.id !== params.excludeSignalId)
      .slice(0, maxMatchCount);

    return {
      embedding,
      matches: rankedMatches,
    };
  } catch (error) {
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
}): Promise<{ embedding?: EmbeddingResult; matches: SignalMatchSummary[] }> {
  const semanticResult = await findSemanticSameFrequencyMatches(params);
  const keywordMatches = await findKeywordSameFrequencyMatches(params.fingerprint, {
    excludeSignalId: params.excludeSignalId,
  });

  if (semanticResult === undefined || semanticResult.matches.length === 0) {
    return {
      matches: keywordMatches,
    };
  }

  const existingIds = new Set(semanticResult.matches.map((match) => match.id));
  const matches = [
    ...semanticResult.matches,
    ...keywordMatches.filter((match) => !existingIds.has(match.id)),
  ].slice(0, maxMatchCount);

  return {
    embedding: semanticResult.embedding,
    matches,
  };
}
