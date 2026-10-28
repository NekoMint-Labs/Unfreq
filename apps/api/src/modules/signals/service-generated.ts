import type { EmbeddingLogger } from "../ai/embedding.js";
import {
  analyzeSignalIntentWithFallback,
  generateSignalContentWithFallback,
  generateSignalFingerprintWithFallback,
  scoreSignalQualityWithFallback,
} from "../ai/service.js";
import {
  createSignalDraft,
  listSignalsByRawInput,
} from "./repository.js";
import { buildSeedSignalInputs } from "./seed-data.js";
import { aiGenerationMaxAttempts } from "./service-constants.js";
import { generateReviewedSignalExpansion } from "./service-creation.js";
import {
  queueSignalEmbeddingWrite,
  writeInitialSignalGalaxyPosition,
  writeSignalEmbedding,
} from "./service-embedding.js";
import { toSafeErrorReason } from "./service-errors.js";
import { findSameFrequencyMatches } from "./service-matching.js";
import {
  buildMinimalSignalProgram,
  getFingerprintFrequencyProfile,
  toSignalDetail,
} from "./service-mappers.js";
import { personas, pickPersonas, randomInt } from "./service-personas.js";
import type {
  AiGeneratedSignalResult,
  AiSignalGenerationSummary,
  SignalContentQuality,
  SignalDetail,
  SignalPersona,
  SignalSource,
} from "./types.js";

type SignalGenerationAttempt = {
  attempts: number;
  result?: AiGeneratedSignalResult;
};

async function createGeneratedSignal(params: {
  expandedText?: string;
  followUpQuestion?: string;
  logger?: EmbeddingLogger;
  quality: SignalContentQuality;
  rawInput: string;
  source: SignalSource;
  syncEmbedding?: boolean;
}): Promise<SignalDetail> {
  const fingerprintResult = await generateSignalFingerprintWithFallback({
    content: params.rawInput,
  });
  const fingerprint = fingerprintResult.result;
  const frequencyProfile = getFingerprintFrequencyProfile(fingerprint);
  const classification =
    params.expandedText === undefined
      ? undefined
      : (await analyzeSignalIntentWithFallback({
          content: params.rawInput,
        })).result;
  const reviewedExpansion =
    params.expandedText === undefined
      ? await generateReviewedSignalExpansion({
          logger: params.logger,
          seedText: params.rawInput,
        })
      : undefined;
  const expansion =
    reviewedExpansion === undefined
      ? {
          expandedText: params.expandedText ?? params.rawInput,
          followUpQuestion: params.followUpQuestion,
        }
      : reviewedExpansion.expansion;
  const matchResult = await findSameFrequencyMatches({
    classification: reviewedExpansion?.classification ?? classification,
    expandedText: expansion.expandedText,
    fingerprint,
    logger: params.logger,
    rawInput: params.rawInput,
  });
  const primaryMatch = matchResult.matches[0];
  const program = buildMinimalSignalProgram({
    expandedText: expansion.expandedText,
    fingerprint,
    match: primaryMatch,
    rawInput: params.rawInput,
  });
  const signal = await createSignalDraft({
    expandedText: expansion.expandedText,
    fingerprint,
    followUpQuestion: expansion.followUpQuestion,
    frequencyProfile,
    matchSignalId: primaryMatch?.source === "PUBLISHED" ? primaryMatch.id : undefined,
    program,
    qualityReason: params.quality.reason,
    qualityScore: params.quality.score,
    rawInput: params.rawInput,
    seedText: params.rawInput,
    source: params.source,
    status: "PUBLISHED",
  });
  const positionedSignal = await writeInitialSignalGalaxyPosition({
    embeddingVersion: matchResult.embedding?.version,
    logger: params.logger,
    signal,
  });

  if (params.syncEmbedding === true) {
    try {
      await writeSignalEmbedding({
        embedding: matchResult.embedding,
        logger: params.logger,
        signal: positionedSignal,
      });
    } catch (error) {
      params.logger?.warn(
        {
          action: "signal.embedding.write",
          reason: toSafeErrorReason(error),
          targetId: signal.id,
          targetType: "SIGNAL",
        },
        "signal embedding write failed",
      );
    }
  } else {
    queueSignalEmbeddingWrite({
      embedding: matchResult.embedding,
      logger: params.logger,
      signal: positionedSignal,
    });
  }

  return {
    ...toSignalDetail(positionedSignal),
    matches: matchResult.matches,
  };
}

async function generateSignalForPersona(params: {
  logger?: EmbeddingLogger;
  persona: SignalPersona;
}): Promise<SignalGenerationAttempt> {
  let attempts = 0;

  for (let attempt = 1; attempt <= aiGenerationMaxAttempts; attempt += 1) {
    attempts += 1;
    const contentResult = await generateSignalContentWithFallback(params.persona);
    const qualityResult = await scoreSignalQualityWithFallback({
      content: contentResult.result.rawInput,
    });

    if (qualityResult.result.score < 3) {
      params.logger?.warn(
        {
          action: "signal.ai_content.quality_rejected",
          attempt,
          personaId: params.persona.id,
          score: qualityResult.result.score,
        },
        "ai signal content rejected",
      );
      continue;
    }

    return {
      attempts,
      result: {
        persona: params.persona,
        quality: qualityResult.result,
        signal: await createGeneratedSignal({
          logger: params.logger,
          quality: qualityResult.result,
          rawInput: contentResult.result.rawInput,
          source: "ai_generated",
        }),
      },
    };
  }

  return {
    attempts,
  };
}

export async function generateAiSignals(params: {
  count?: number;
  logger?: EmbeddingLogger;
} = {}): Promise<AiSignalGenerationSummary> {
  const count = Math.min(Math.max(params.count ?? randomInt(5, 10), 1), 10);
  const results: AiGeneratedSignalResult[] = [];
  let attempts = 0;
  let rejected = 0;

  for (const persona of pickPersonas(count, new Date().getDate())) {
    const attempt = await generateSignalForPersona({
      logger: params.logger,
      persona,
    });

    attempts += attempt.attempts;

    if (attempt.result === undefined) {
      rejected += 1;
      continue;
    }

    results.push(attempt.result);
  }

  params.logger?.info(
    {
      accepted: results.length,
      action: "signal.ai_content.generate_batch",
      attempts,
      rejected,
    },
    "ai signal generation batch completed",
  );

  return {
    accepted: results.length,
    attempts,
    rejected,
    results,
  };
}

export async function seedSignalLibrary(params: {
  logger?: EmbeddingLogger;
} = {}): Promise<AiSignalGenerationSummary> {
  const inputs = buildSeedSignalInputs();
  const seedTexts = inputs.map((input) => input.seedText);
  const existingSignals = await listSignalsByRawInput(seedTexts);
  const existingRawInputs = new Set(existingSignals.map((signal) => signal.rawInput));
  const results: AiGeneratedSignalResult[] = [];
  let attempts = 0;
  const rejected = 0;

  for (const input of inputs) {
    if (existingRawInputs.has(input.seedText)) {
      continue;
    }

    attempts += 1;
    const quality = {
      reason: "固定种子内容，人工筛选通过。",
      score: 5,
    };

    results.push({
      persona: personas[results.length % personas.length],
      quality,
      signal: await createGeneratedSignal({
        expandedText: input.expandedText,
        logger: params.logger,
        quality,
        rawInput: input.seedText,
        source: "seed",
        syncEmbedding: true,
      }),
    });
  }

  params.logger?.info(
    {
      accepted: results.length,
      action: "signal.seed_library.initialize",
      attempts,
      existing: existingSignals.length,
      rejected,
      total: inputs.length,
    },
    "signal seed library initialized",
  );

  return {
    accepted: results.length,
    attempts,
    rejected,
    results,
  };
}
