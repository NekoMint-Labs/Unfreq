import { AppError } from "../../shared/errors.js";
import type { EmbeddingLogger, EmbeddingResult } from "../ai/embedding.js";
import {
  analyzeSignalIntentWithFallback,
  generateSignalMaterial,
  generateSignalExpansionWithFallback,
  generateSignalFingerprintWithFallback,
  reviewSignalExpansionWithFallback,
} from "../ai/service.js";
import type {
  AiSignalExpansion,
  AiSignalExpansionReview,
  AiSignalSeedClassification,
} from "../ai/signal-types.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { CreatePublishedSignalBody } from "./schemas.js";
import type { SignalFrequencyProfile } from "./frequency-taxonomy.js";
import {
  completeSignalGeneration,
  createSignalDraft,
  findVisibleSignalForFrequency,
  updateSignalGenerationStatus,
} from "./repository.js";
import {
  queueSignalEmbeddingWrite,
  writeInitialSignalGalaxyPosition,
} from "./service-embedding.js";
import {
  toSafeAiErrorFailureDetails,
  toSafeErrorReason,
} from "./service-errors.js";
import { findSameFrequencyMatches } from "./service-matching.js";
import {
  buildMinimalSignalProgram,
  getFingerprintFrequencyProfile,
  toSignalGenerationDetail,
  toSignalDetail,
  toShortText,
} from "./service-mappers.js";
import type {
  SignalDetail,
  SignalFingerprint,
  SignalGenerationDetail,
  SignalGenerationStatus,
  SignalMatchSummary,
  SignalStatus,
} from "./types.js";

type ReviewedSignalExpansion = {
  classification: AiSignalSeedClassification;
  expansion: AiSignalExpansion;
  review: AiSignalExpansionReview;
};

type SignalCreationBoundary =
  | "fingerprint_generation"
  | "parent_visibility"
  | "same_frequency_matching"
  | "signal_persistence";

type SignalGenerationProgressWriter = (status: SignalGenerationStatus) => Promise<void>;

function logSignalCreationBoundaryFailure(params: {
  boundary: SignalCreationBoundary;
  error: unknown;
  logger?: EmbeddingLogger;
}) {
  params.logger?.warn(
    {
      action: "signal.creation.failed",
      signalCreationBoundary: params.boundary,
      ...toSafeAiErrorFailureDetails(params.error),
      reason: toSafeErrorReason(params.error),
      targetType: "SIGNAL",
    },
    "signal creation boundary failed",
  );
}

function isContradictoryPassingReview(review: AiSignalExpansionReview): boolean {
  return (
    !review.pass &&
    review.score >= 8 &&
    review.problems.length === 0 &&
    review.rewriteInstruction.length === 0 &&
    review.matchesSeedType &&
    review.preservesOriginalDirection &&
    !review.isGenericLiteraryTemplate &&
    !review.isForcedNegative
  );
}

async function runSignalCreationBoundary<T>(params: {
  boundary: SignalCreationBoundary;
  logger?: EmbeddingLogger;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await params.run();
  } catch (error) {
    logSignalCreationBoundaryFailure({
      boundary: params.boundary,
      error,
      logger: params.logger,
    });

    throw error;
  }
}

async function reviewOrRewriteSignalExpansion(params: {
  classification: AiSignalSeedClassification;
  expansion: AiSignalExpansion;
  logger?: EmbeddingLogger;
  seedText: string;
}): Promise<{
  expansion: AiSignalExpansion;
  review: AiSignalExpansionReview;
}> {
  let expansion = params.expansion;
  let review = (
    await reviewSignalExpansionWithFallback({
      classification: params.classification,
      expandedText: expansion.expandedText,
      seedText: params.seedText,
    })
  ).result;

  if (isContradictoryPassingReview(review)) {
    params.logger?.warn(
      {
        action: "signal.expansion.review_contradictory",
        reason: "INVALID_AI_REVIEW",
        targetType: "SIGNAL",
      },
      "signal expansion review contradicted itself",
    );

    review = {
      ...review,
      pass: true,
    };
  }

  if (!review.pass) {
    try {
      expansion = (
        await generateSignalExpansionWithFallback({
          classification: params.classification,
          rewriteInstruction: review.rewriteInstruction,
          seedText: params.seedText,
        }, undefined, { skipDirectionReview: true })
      ).result;
    } catch (error) {
      params.logger?.warn(
        {
          action: "signal.expansion.rewrite_failed",
          ...toSafeAiErrorFailureDetails(error),
          reason: toSafeErrorReason(error),
          targetType: "SIGNAL",
        },
        "signal expansion rewrite failed",
      );
      throw error;
    }

    review = (
      await reviewSignalExpansionWithFallback({
        classification: params.classification,
        expandedText: expansion.expandedText,
        seedText: params.seedText,
      })
    ).result;
  }

  if (!review.pass) {
    params.logger?.warn(
      {
        action: "signal.expansion.review_failed",
        problems: review.problems,
        reason: "AI_UNAVAILABLE",
        targetType: "SIGNAL",
      },
      "signal expansion review failed",
    );

    throw new AppError("AI_UNAVAILABLE", "AI provider returned off-direction expansion.");
  }

  return {
    expansion,
    review,
  };
}

export async function generateReviewedSignalExpansion(params: {
  logger?: EmbeddingLogger;
  seedText: string;
}): Promise<ReviewedSignalExpansion> {
  const classificationResult = await analyzeSignalIntentWithFallback({
    content: params.seedText,
  });
  const classification = classificationResult.result;
  let expansion: AiSignalExpansion;
  try {
    expansion = (
      await generateSignalExpansionWithFallback({
        classification,
        seedText: params.seedText,
      }, undefined, { skipDirectionReview: true })
    ).result;
  } catch (error) {
    params.logger?.warn(
      {
        action: "signal.expansion.failed",
        ...toSafeAiErrorFailureDetails(error),
        reason: toSafeErrorReason(error),
        targetType: "SIGNAL",
      },
      "signal expansion failed",
    );
    throw error;
  }
  const reviewedExpansion = await reviewOrRewriteSignalExpansion({
    classification,
    expansion,
    logger: params.logger,
    seedText: params.seedText,
  });

  return {
    classification,
    expansion: reviewedExpansion.expansion,
    review: reviewedExpansion.review,
  };
}

function toHomepageSignalStatus(fingerprint: SignalFingerprint): SignalStatus {
  return fingerprint.riskLevel === "HIGH" ? "REVIEWING" : "PUBLISHED";
}

function toHomepagePendingSignalStatus(fingerprint: SignalFingerprint): SignalStatus {
  return fingerprint.riskLevel === "HIGH" ? "REVIEWING" : "DRAFT";
}

function requireActiveSignalFrequency(
  frequency: AuthenticatedFrequency | undefined,
): AuthenticatedFrequency {
  if (frequency === undefined) {
    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  }

  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot publish now.");
  }

  return frequency;
}

async function assertParentSignalVisible(params: {
  frequencyId: string;
  logger?: EmbeddingLogger;
  parentSignalId?: string;
}) {
  const parentSignalId = params.parentSignalId;

  if (parentSignalId === undefined) {
    return;
  }

  await runSignalCreationBoundary({
    boundary: "parent_visibility",
    logger: params.logger,
    run: async () => {
      const parentSignal = await findVisibleSignalForFrequency({
        frequencyId: params.frequencyId,
        id: parentSignalId,
      });

      if (parentSignal === undefined) {
        throw new AppError("NOT_FOUND", "Parent signal not found.");
      }
    },
  });
}

type SignalCreationMaterial = {
  fingerprint: SignalFingerprint;
  frequencyProfile: SignalFrequencyProfile;
  matchResult: {
    embedding?: EmbeddingResult;
    matches: SignalMatchSummary[];
  };
  reviewedExpansion: ReviewedSignalExpansion;
};

async function buildSignalCreationMaterial(params: {
  logger?: EmbeddingLogger;
  onGenerationStatusChange?: SignalGenerationProgressWriter;
  rawInput: string;
}): Promise<SignalCreationMaterial> {
  await params.onGenerationStatusChange?.("EXPANDING");

  const combinedMaterial = await generateCombinedSignalCreationMaterial(params);

  if (combinedMaterial !== undefined) {
    return combinedMaterial;
  }

  const fingerprintResult = await runSignalCreationBoundary({
    boundary: "fingerprint_generation",
    logger: params.logger,
    run: () => generateSignalFingerprintWithFallback({
      content: params.rawInput,
    }),
  });
  const fingerprint = fingerprintResult.result;
  const frequencyProfile = getFingerprintFrequencyProfile(fingerprint);
  const reviewedExpansion = await generateReviewedSignalExpansion({
    logger: params.logger,
    seedText: params.rawInput,
  });
  await params.onGenerationStatusChange?.("MATCHING");
  const matchResult = await findSameFrequencyMatchesForCreation({
    classification: reviewedExpansion.classification,
    expandedText: reviewedExpansion.expansion.expandedText,
    fingerprint,
    logger: params.logger,
    rawInput: params.rawInput,
  });

  return {
    fingerprint,
    frequencyProfile,
    matchResult,
    reviewedExpansion,
  };
}

async function generateCombinedSignalCreationMaterial(params: {
  logger?: EmbeddingLogger;
  onGenerationStatusChange?: SignalGenerationProgressWriter;
  rawInput: string;
}): Promise<SignalCreationMaterial | undefined> {
  let materialResult: Awaited<ReturnType<typeof generateSignalMaterial>>;

  try {
    materialResult = await generateSignalMaterial({
      content: params.rawInput,
    });
  } catch (error) {
    params.logger?.warn(
      {
        action: "signal.material.failed",
        ...toSafeAiErrorFailureDetails(error),
        reason: toSafeErrorReason(error),
        targetType: "SIGNAL",
      },
      "signal material generation failed",
    );

    return undefined;
  }

  const fingerprint = materialResult.result.fingerprint;
  const expansionReview = await reviewOrRewriteSignalExpansion({
    classification: materialResult.result.classification,
    expansion: materialResult.result.expansion,
    logger: params.logger,
    seedText: params.rawInput,
  });
  const reviewedExpansion = {
    classification: materialResult.result.classification,
    expansion: expansionReview.expansion,
    review: expansionReview.review,
  };
  await params.onGenerationStatusChange?.("MATCHING");
  const matchResult = await findSameFrequencyMatchesForCreation({
    classification: reviewedExpansion.classification,
    expandedText: reviewedExpansion.expansion.expandedText,
    fingerprint,
    logger: params.logger,
    rawInput: params.rawInput,
  });

  return {
    fingerprint,
    frequencyProfile: getFingerprintFrequencyProfile(fingerprint),
    matchResult,
    reviewedExpansion,
  };
}

async function findSameFrequencyMatchesForCreation(params: {
  classification?: AiSignalSeedClassification;
  expandedText: string;
  fingerprint: SignalFingerprint;
  logger?: EmbeddingLogger;
  rawInput: string;
}): Promise<SignalCreationMaterial["matchResult"]> {
  try {
    return await findSameFrequencyMatches(params);
  } catch (error) {
    logSignalCreationBoundaryFailure({
      boundary: "same_frequency_matching",
      error,
      logger: params.logger,
    });

    return {
      matches: [],
    };
  }
}

function buildSignalDraftInput(params: {
  body: CreatePublishedSignalBody;
  frequency: AuthenticatedFrequency;
  material: SignalCreationMaterial;
  status: SignalStatus;
}): Parameters<typeof createSignalDraft>[0] {
  const expansion = params.material.reviewedExpansion.expansion;
  const matches = params.material.matchResult.matches;
  const primaryMatch = matches[0];
  const program = buildMinimalSignalProgram({
    expandedText: expansion.expandedText,
    fingerprint: params.material.fingerprint,
    match: primaryMatch,
    rawInput: params.body.seedText,
  });
  const review = params.material.reviewedExpansion.review;

  return {
    authorId: params.frequency.id,
    expandedText: expansion.expandedText,
    fingerprint: params.material.fingerprint,
    followUpQuestion: expansion.followUpQuestion,
    frequencyProfile: params.material.frequencyProfile,
    frequencyId: params.frequency.id,
    matchSignalId: primaryMatch?.source === "PUBLISHED" ? primaryMatch.id : undefined,
    parentSignalId: params.body.parentSignalId,
    program,
    qualityReason: review.pass
      ? `扩写质检通过，评分 ${review.score}`
      : `扩写质检仍有问题：${review.problems.join("；")}`,
    qualityScore: Math.max(1, Math.min(5, Math.round(review.score / 2))),
    rawInput: params.body.seedText,
    seedText: params.body.seedText,
    status: params.status,
  };
}

async function createSignalFromMaterial(params: {
  body: CreatePublishedSignalBody;
  frequency: AuthenticatedFrequency;
  logger?: EmbeddingLogger;
  onGenerationStatusChange?: SignalGenerationProgressWriter;
  resolveStatus: (fingerprint: SignalFingerprint) => SignalStatus;
}): Promise<SignalDetail> {
  await assertParentSignalVisible({
    frequencyId: params.frequency.id,
    logger: params.logger,
    parentSignalId: params.body.parentSignalId,
  });

  const material = await buildSignalCreationMaterial({
    logger: params.logger,
    onGenerationStatusChange: params.onGenerationStatusChange,
    rawInput: params.body.seedText,
  });
  await params.onGenerationStatusChange?.("WRITING");
  const signal = await runSignalCreationBoundary({
    boundary: "signal_persistence",
    logger: params.logger,
    run: () => createSignalDraft(buildSignalDraftInput({
      body: params.body,
      frequency: params.frequency,
      material,
      status: params.resolveStatus(material.fingerprint),
    })),
  });
  const positionedSignal = await writeInitialSignalGalaxyPosition({
    embeddingVersion: material.matchResult.embedding?.version,
    logger: params.logger,
    signal,
  });
  queueSignalEmbeddingWrite({
    embedding: material.matchResult.embedding,
    logger: params.logger,
    signal: positionedSignal,
  });

  return {
    ...toSignalDetail(positionedSignal),
    matches: material.matchResult.matches,
  };
}

const queuedSignalGenerationIds = new Set<string>();

function buildPendingSignalFingerprint(params: {
  frequency: AuthenticatedFrequency;
  seedText: string;
}): SignalFingerprint {
  const frequencyCode = params.frequency.code ?? params.frequency.freqCode;
  const title = toShortText(params.seedText, 24);

  return {
    coreNeed: "等待信号完成",
    displayText: "自我镜像 · 自我怀疑",
    energy: 0.5,
    emotionTone: "安静等待",
    frequency: frequencyCode,
    hiddenNeed: "等待信号完成",
    innerConflict: "信号已经接收，仍在生成结果",
    narrativeConflict: "信号已经接收，仍在生成结果",
    openness: 0.5,
    primaryBand: "self_mirror",
    primaryEmotion: "等待",
    resonanceKeywords: ["等待", "发射", "同频"],
    riskLevel: "LOW",
    secondaryEmotions: ["等待"],
    signalType: "pending_signal",
    subFeeling: "self_doubt",
    tags: ["等待"],
    theme: "信号生成",
    title: title.length > 0 ? title : "信号生成",
  };
}

function buildPendingSignalInput(params: {
  body: CreatePublishedSignalBody;
  frequency: AuthenticatedFrequency;
}): Parameters<typeof createSignalDraft>[0] {
  const fingerprint = buildPendingSignalFingerprint({
    frequency: params.frequency,
    seedText: params.body.seedText,
  });
  const frequencyProfile = getFingerprintFrequencyProfile(fingerprint);
  const expandedText = "信号正在生成。";

  return {
    authorId: params.frequency.id,
    expandedText,
    fingerprint,
    frequencyId: params.frequency.id,
    frequencyProfile,
    generationStatus: "RECEIVED",
    parentSignalId: params.body.parentSignalId,
    program: buildMinimalSignalProgram({
      expandedText,
      fingerprint,
      rawInput: params.body.seedText,
    }),
    rawInput: params.body.seedText,
    seedText: params.body.seedText,
    status: "DRAFT",
  };
}

async function completePendingSignalFromMaterial(params: {
  body: CreatePublishedSignalBody;
  frequency: AuthenticatedFrequency;
  logger?: EmbeddingLogger;
  resolveStatus: (fingerprint: SignalFingerprint) => SignalStatus;
  signalId: string;
}): Promise<SignalDetail> {
  const writeGenerationStatus: SignalGenerationProgressWriter = async (status) => {
    await updateSignalGenerationStatus({
      id: params.signalId,
      status,
    });
  };
  const material = await buildSignalCreationMaterial({
    logger: params.logger,
    onGenerationStatusChange: writeGenerationStatus,
    rawInput: params.body.seedText,
  });
  await writeGenerationStatus("WRITING");
  const signalInput = buildSignalDraftInput({
    body: params.body,
    frequency: params.frequency,
    material,
    status: params.resolveStatus(material.fingerprint),
  });
  const signal = await runSignalCreationBoundary({
    boundary: "signal_persistence",
    logger: params.logger,
    run: async () => {
      const completedSignal = await completeSignalGeneration({
        id: params.signalId,
        input: signalInput,
      });

      if (completedSignal === undefined) {
        throw new Error("Pending signal could not be completed.");
      }

      return completedSignal;
    },
  });
  const positionedSignal = await writeInitialSignalGalaxyPosition({
    embeddingVersion: material.matchResult.embedding?.version,
    logger: params.logger,
    signal,
  });
  queueSignalEmbeddingWrite({
    embedding: material.matchResult.embedding,
    logger: params.logger,
    signal: positionedSignal,
  });

  return {
    ...toSignalDetail(positionedSignal),
    matches: material.matchResult.matches,
  };
}

function queuePendingSignalGeneration(params: {
  body: CreatePublishedSignalBody;
  frequency: AuthenticatedFrequency;
  logger?: EmbeddingLogger;
  signalId: string;
}) {
  if (queuedSignalGenerationIds.has(params.signalId)) {
    return;
  }

  queuedSignalGenerationIds.add(params.signalId);

  void (async () => {
    try {
      const signal = await completePendingSignalFromMaterial({
        body: params.body,
        frequency: params.frequency,
        logger: params.logger,
        resolveStatus: toHomepagePendingSignalStatus,
        signalId: params.signalId,
      });

      params.logger?.info(
        {
          action: "signal.generation.completed",
          generationStatus: "COMPLETED",
          targetId: signal.id,
          targetType: "SIGNAL",
        },
        "signal generation completed",
      );
    } catch (error) {
      params.logger?.warn(
        {
          action: "signal.generation.failed",
          ...toSafeAiErrorFailureDetails(error),
          generationStatus: "FAILED",
          reason: toSafeErrorReason(error),
          targetId: params.signalId,
          targetType: "SIGNAL",
        },
        "signal generation failed",
      );
      try {
        await updateSignalGenerationStatus({
          error: toSafeErrorReason(error),
          id: params.signalId,
          status: "FAILED",
        });
      } catch (statusError) {
        params.logger?.warn(
          {
            action: "signal.generation.status_failed",
            reason: toSafeErrorReason(statusError),
            targetId: params.signalId,
            targetType: "SIGNAL",
          },
          "signal generation failure status write failed",
        );
      }
    } finally {
      queuedSignalGenerationIds.delete(params.signalId);
    }
  })();
}

export async function createPendingSignal(
  frequency: AuthenticatedFrequency | undefined,
  body: CreatePublishedSignalBody,
  logger?: EmbeddingLogger,
): Promise<SignalGenerationDetail> {
  const activeFrequency = requireActiveSignalFrequency(frequency);

  await assertParentSignalVisible({
    frequencyId: activeFrequency.id,
    logger,
    parentSignalId: body.parentSignalId,
  });

  const signal = await createSignalDraft(buildPendingSignalInput({
    body,
    frequency: activeFrequency,
  }));
  const generationDetail = toSignalGenerationDetail(signal);
  queuePendingSignalGeneration({
    body,
    frequency: activeFrequency,
    logger,
    signalId: signal.id,
  });

  return generationDetail;
}

export async function createPublishedSignal(
  frequency: AuthenticatedFrequency | undefined,
  body: CreatePublishedSignalBody,
  logger?: EmbeddingLogger,
): Promise<SignalDetail> {
  const activeFrequency = requireActiveSignalFrequency(frequency);

  return createSignalFromMaterial({
    body,
    frequency: activeFrequency,
    logger,
    resolveStatus: toHomepageSignalStatus,
  });
}
