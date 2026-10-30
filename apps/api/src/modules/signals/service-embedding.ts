import { signalEmbeddingText } from "../ai/embedding-space.js";
import {
  generateEmbedding,
  type EmbeddingLogger,
  type EmbeddingResult,
  isEmbeddingProviderConfigured,
} from "../ai/embedding.js";
import type { AiSignalSeedClassification } from "../ai/signal-types.js";
import { assertGenerationActive, throwIfGenerationStopped } from "../../shared/generation-execution.js";
import {
  writeSignalEmbeddingIfMissing,
  writeSignalGalaxyPositionIfMissing,
} from "./repository.js";
import { toSafeErrorReason } from "./service-errors.js";
import {
  buildInitialGalaxyPosition,
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
  return signalEmbeddingText(input.expandedText);
}

// The durable pending path awaits this optional tail before its completion
// CAS. It never starts an untracked write after COMPLETED. Other existing
// callers retain their independent embedding behavior below.
export async function resolveGenerationEmbedding(params: {
  embedding?: EmbeddingResult;
  expandedText: string;
  fingerprint: SignalFingerprint;
  logger?: EmbeddingLogger;
  seedText: string;
  signalId: string;
}): Promise<EmbeddingResult | undefined> {
  await assertGenerationActive();
  try {
    if (params.embedding !== undefined) return params.embedding;
    if (!(await isEmbeddingProviderConfigured())) return undefined;
    await assertGenerationActive();
    const embedding = await generateEmbedding(buildSignalEmbeddingText(params), { logger: params.logger });
    await assertGenerationActive();
    return embedding;
  } catch (error) {
    throwIfGenerationStopped(error);
    params.logger?.warn({
      action: "signal.embedding.generation_failed",
      reason: toSafeErrorReason(error),
      targetId: params.signalId,
      targetType: "SIGNAL",
    }, "optional signal embedding failed");
    return undefined;
  }
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
        expectedExpandedText: params.signal.expandedText,
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
    expectedExpandedText: params.signal.expandedText,
    embedding: embedding.embedding,
    id: params.signal.id,
  });
}
