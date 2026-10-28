import { AppError } from "../../shared/errors.js";
import {
  isTtsProviderConfigured,
  synthesize,
  type TtsLogger,
} from "../ai/tts.js";
import {
  buildSignalAudioStorageKey,
  readSignalAudio,
  writeSignalAudio,
} from "./audio-storage.js";
import {
  findPublishedSignalById,
  markSignalAudioFailed,
  markSignalAudioPending,
  markSignalAudioReady,
} from "./repository.js";
import { toSafeErrorReason } from "./service-errors.js";
import {
  toSignalAudioDetail,
  toUnavailableTtsAudioDetail,
} from "./service-mappers.js";
import type { SignalAudioDetail, SignalRecord } from "./types.js";

const queuedSignalAudioIds = new Set<string>();

function buildAudioUrl(signalId: string, channel: "left" | "main" | "right" = "main"): string {
  return `/api/signals/${signalId}/audio/${channel}`;
}

function queueSignalAudioGeneration(params: {
  logger?: TtsLogger;
  signal: SignalRecord;
}) {
  if (
    params.signal.audioStatus === "READY" ||
    params.signal.audioStatus === "FAILED" ||
    queuedSignalAudioIds.has(params.signal.id)
  ) {
    return;
  }

  queuedSignalAudioIds.add(params.signal.id);

  void (async () => {
    try {
      const audio = await synthesize(params.signal.expandedText, undefined, 0.96, {
        logger: params.logger,
      });
      const storageKey = buildSignalAudioStorageKey(params.signal.id, "main");
      const url = buildAudioUrl(params.signal.id);

      await writeSignalAudio(storageKey, audio);
      await markSignalAudioReady({
        id: params.signal.id,
        storageKey,
        storageKeyLeft: storageKey,
        storageKeyRight: storageKey,
        url,
        urlLeft: url,
        urlRight: url,
      });

      params.logger?.info(
        {
          action: "signal.audio.generate",
          targetId: params.signal.id,
          targetType: "SIGNAL",
        },
        "signal audio generation completed",
      );
    } catch (error) {
      await markSignalAudioFailed({
        error: toSafeErrorReason(error),
        id: params.signal.id,
      });
      params.logger?.warn(
        {
          action: "signal.audio.generate",
          reason: toSafeErrorReason(error),
          targetId: params.signal.id,
          targetType: "SIGNAL",
        },
        "signal audio generation failed",
      );
    } finally {
      queuedSignalAudioIds.delete(params.signal.id);
    }
  })();
}

export async function getSignalAudio(id: string, _logger?: TtsLogger): Promise<SignalAudioDetail> {
  const signal = await findPublishedSignalById(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  return toSignalAudioDetail(signal);
}

export async function requestSignalAudio(id: string, logger?: TtsLogger): Promise<SignalAudioDetail> {
  const signal = await findPublishedSignalById(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.audioStatus === "READY" || signal.audioStatus === "PENDING") {
    return toSignalAudioDetail(signal);
  }

  if (!(await isTtsProviderConfigured())) {
    const failedSignal = await markSignalAudioFailed({
      error: "TTS provider is not configured.",
      id: signal.id,
    });

    return toUnavailableTtsAudioDetail(failedSignal ?? signal);
  }

  const pendingSignal = await markSignalAudioPending(signal.id);

  if (pendingSignal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  queueSignalAudioGeneration({
    logger,
    signal: pendingSignal,
  });

  return toSignalAudioDetail(pendingSignal);
}

export async function getSignalAudioDownload(
  id: string,
  side: "left" | "main" | "right",
): Promise<{ sizeBytes?: number; stream: Awaited<ReturnType<typeof readSignalAudio>> }> {
  const signal = await findPublishedSignalById(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.audioStatus !== "READY") {
    throw new AppError("CONFLICT", "Signal audio is not ready.");
  }

  const storageKey =
    side === "main"
      ? signal.audioStorageKey
      : side === "left"
        ? signal.audioStorageKeyLeft
        : signal.audioStorageKeyRight;

  if (storageKey === null) {
    throw new AppError("NOT_FOUND", "Signal audio not found.");
  }

  return {
    stream: await readSignalAudio(storageKey),
  };
}
