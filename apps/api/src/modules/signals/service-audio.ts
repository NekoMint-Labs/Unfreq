import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { AppError } from "../../shared/errors.js";
import { isTtsProviderConfigured, type TtsLogger } from "../ai/tts.js";
import { readSignalAudio } from "./audio-storage.js";
import type { SignalAudioWorker } from "./audio-worker.js";
import { findPublishedSignalById, markSignalAudioFailed } from "./repository.js";
import { toSignalAudioDetail, toUnavailableTtsAudioDetail } from "./service-mappers.js";
import type { SignalAudioDetail } from "./types.js";

export async function getSignalAudio(id: string, _logger?: TtsLogger): Promise<SignalAudioDetail> {
  const signal = await findPublishedSignalById(id);
  if (signal === undefined) throw new AppError("NOT_FOUND", "Signal not found.");
  return toSignalAudioDetail(signal);
}

export async function requestSignalAudio(id: string, logger?: TtsLogger,
  context?: { clientIp: string; worker?: SignalAudioWorker }): Promise<SignalAudioDetail> {
  // Real routes supply their app-owned worker. Its bounded pool owns even the
  // first public read/config preparation, not just the detached TTS call.
  if (context?.worker !== undefined) return context.worker.request(id, context.clientIp, logger);
  const signal = await findPublishedSignalById(id);
  if (signal === undefined) throw new AppError("NOT_FOUND", "Signal not found.");
  if (signal.audioStatus === "READY" || signal.audioStatus === "PENDING") return toSignalAudioDetail(signal);
  if (!(await isTtsProviderConfigured())) {
    const fallback = await markSignalAudioFailed({ id, error: "TTS provider is not configured." });
    return toUnavailableTtsAudioDetail(fallback ?? signal);
  }
  // Compatibility callers may read cached/local fallback results, but cannot
  // start a global/legacy unsupervised paid job by omitting context.
  throw new AbuseControlStopped("unavailable", "configuration");
}

export async function getSignalAudioDownload(id: string, side: "left" | "main" | "right"):
Promise<{ sizeBytes?: number; stream: Awaited<ReturnType<typeof readSignalAudio>> }> {
  const signal = await findPublishedSignalById(id);
  if (signal === undefined) throw new AppError("NOT_FOUND", "Signal not found.");
  if (signal.audioStatus !== "READY") throw new AppError("CONFLICT", "Signal audio is not ready.");
  const storageKey = side === "main" ? signal.audioStorageKey : side === "left" ? signal.audioStorageKeyLeft : signal.audioStorageKeyRight;
  if (storageKey === null) throw new AppError("NOT_FOUND", "Signal audio not found.");
  return { stream: await readSignalAudio(storageKey) };
}
