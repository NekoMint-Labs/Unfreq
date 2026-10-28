import {
  generateEmbedding,
  type EmbeddingLogger,
  type EmbeddingResult,
  isEmbeddingProviderConfigured,
} from "../ai/embedding.js";
import type { AiSignalSeedClassification } from "../ai/signal-types.js";
import {
  writeSignalEmbeddingIfMissing,
  writeSignalGalaxyPositionIfMissing,
} from "./repository.js";
import { toSafeErrorReason } from "./service-errors.js";
import {
  buildInitialGalaxyPosition,
  getFingerprintFrequencyProfile,
  isFiniteGalaxyPosition,
} from "./service-mappers.js";
import type {
  SignalEmbeddingMeta,
  SignalFingerprint,
  SignalGalaxyPosition,
  SignalRecord,
} from "./types.js";

function toSignalEmbeddingMeta(embedding: EmbeddingResult): SignalEmbeddingMeta {
  return {
    dimensions: embedding.dimensions,
    model: embedding.model,
    provider: embedding.provider,
    version: embedding.version,
  };
}

export function buildSignalEmbeddingText(input: {
  classification?: AiSignalSeedClassification;
  expandedText: string;
  fingerprint: SignalFingerprint;
  seedText?: string;
}): string {
  const frequencyProfile = getFingerprintFrequencyProfile(input.fingerprint);

  return [
    input.classification === undefined ? "" : `类型：${input.classification.type}`,
    input.classification === undefined ? "" : `情绪：${input.classification.mood}`,
    input.classification === undefined
      ? ""
      : `扩写方式：${input.classification.expansionMode}`,
    input.classification === undefined
      ? ""
      : `意图焦点：${input.classification.intendedFocus ?? input.classification.keywords.join("、")}`,
    input.classification === undefined
      ? ""
      : `必须保留：${(input.classification.preserve ?? input.classification.keywords).join("、")}`,
    input.classification === undefined || (input.classification.mustAvoid ?? []).length === 0
      ? ""
      : `避免方向：${(input.classification.mustAvoid ?? []).join("、")}`,
    input.classification === undefined
      ? ""
      : `场景方向：${input.classification.sceneHint ?? input.classification.keywords.join("、")}`,
    input.classification === undefined
      ? ""
      : `分类关键词：${input.classification.keywords.join("、")}`,
    `标题：${input.fingerprint.title}`,
    `主频段：${frequencyProfile.displayText}`,
    `情绪色彩：${frequencyProfile.emotionTone}`,
    `核心需求：${frequencyProfile.coreNeed}`,
    `内在冲突：${frequencyProfile.innerConflict}`,
    `共振关键词：${frequencyProfile.resonanceKeywords.join("、")}`,
    input.seedText === undefined ? "" : `原句：${input.seedText}`,
    `扩写：${input.expandedText}`,
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n");
}

export function queueSignalEmbeddingWrite(params: {
  embedding?: EmbeddingResult;
  logger?: EmbeddingLogger;
  signal: SignalRecord;
}) {
  void (async () => {
    try {
      if (params.embedding === undefined && !(await isEmbeddingProviderConfigured())) {
        return;
      }

      const embedding =
        params.embedding ??
        (await generateEmbedding(
          buildSignalEmbeddingText({
            fingerprint: params.signal.fingerprintJson,
            expandedText: params.signal.expandedText,
            seedText: params.signal.seedText,
          }),
          {
            logger: params.logger,
          },
        ));
      const written = await writeSignalEmbeddingIfMissing({
        ...toSignalEmbeddingMeta(embedding),
        embedding: embedding.embedding,
        id: params.signal.id,
      });

      params.logger?.info(
        {
          action: "signal.embedding.write",
          dimensions: embedding.dimensions,
          model: embedding.model,
          provider: embedding.provider,
          targetId: params.signal.id,
          targetType: "SIGNAL",
          version: embedding.version,
          written,
        },
        "signal embedding write completed",
      );
    } catch (error) {
      params.logger?.warn(
        {
          action: "signal.embedding.write",
          reason: toSafeErrorReason(error),
          targetId: params.signal.id,
          targetType: "SIGNAL",
        },
        "signal embedding write failed",
      );
    }
  })();
}

async function writeSignalGalaxyPosition(params: {
  logger?: EmbeddingLogger;
  position: SignalGalaxyPosition;
  signal: SignalRecord;
}): Promise<boolean> {
  const written = await writeSignalGalaxyPositionIfMissing({
    id: params.signal.id,
    position: params.position,
  });

  params.logger?.info(
    {
      action: "signal.galaxy_position.write",
      targetId: params.signal.id,
      targetType: "SIGNAL",
      written,
    },
    "signal galaxy position write completed",
  );

  return written;
}

export function queueSignalGalaxyPositionWrite(params: {
  logger?: EmbeddingLogger;
  position: SignalGalaxyPosition;
  signal: SignalRecord;
}) {
  void (async () => {
    try {
      await writeSignalGalaxyPosition(params);
    } catch (error) {
      params.logger?.warn(
        {
          action: "signal.galaxy_position.write",
          reason: toSafeErrorReason(error),
          targetId: params.signal.id,
          targetType: "SIGNAL",
        },
        "signal galaxy position write failed",
      );
    }
  })();
}

export async function writeInitialSignalGalaxyPosition(params: {
  embeddingVersion?: string;
  logger?: EmbeddingLogger;
  signal: SignalRecord;
}): Promise<SignalRecord> {
  if (isFiniteGalaxyPosition(params.signal.galaxyPosition)) {
    return params.signal;
  }

  const position = buildInitialGalaxyPosition({
    embeddingVersion: params.embeddingVersion ?? params.signal.embeddingVersion ?? undefined,
    expandedText: params.signal.expandedText,
    fingerprint: params.signal.fingerprintJson,
    signalId: params.signal.id,
  });

  try {
    const written = await writeSignalGalaxyPosition({
      logger: params.logger,
      position,
      signal: params.signal,
    });

    return written
      ? {
          ...params.signal,
          galaxyPosition: position,
        }
      : params.signal;
  } catch (error) {
    params.logger?.warn(
      {
        action: "signal.galaxy_position.write",
        reason: toSafeErrorReason(error),
        targetId: params.signal.id,
        targetType: "SIGNAL",
      },
      "signal galaxy position write failed",
    );

    return params.signal;
  }
}

export async function writeSignalEmbedding(params: {
  embedding?: EmbeddingResult;
  logger?: EmbeddingLogger;
  signal: SignalRecord;
}): Promise<boolean> {
  if (params.embedding === undefined && !(await isEmbeddingProviderConfigured())) {
    return false;
  }

  const embedding =
    params.embedding ??
    (await generateEmbedding(
      buildSignalEmbeddingText({
        expandedText: params.signal.expandedText,
        fingerprint: params.signal.fingerprintJson,
        seedText: params.signal.seedText,
      }),
      {
        logger: params.logger,
      },
    ));

  return writeSignalEmbeddingIfMissing({
    ...toSignalEmbeddingMeta(embedding),
    embedding: embedding.embedding,
    id: params.signal.id,
  });
}
