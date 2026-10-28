import {
  normalizeSignalFrequencyProfile,
  type SignalFrequencyProfile,
} from "./frequency-taxonomy.js";
import type {
  MySignalSummary,
  SavedSignalRecord,
  SavedSignalSummary,
  SignalAudioDetail,
  SignalDetail,
  SignalEchoDetail,
  SignalEchoRecord,
  SignalFingerprint,
  SignalGalaxyPosition,
  SignalGenerationDetail,
  SignalMatchSummary,
  SignalPreviewDetail,
  SignalProgram,
  SignalRecord,
  SignalSemanticMatchRecord,
} from "./types.js";

export function toShortText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function getSignalFrequencyProfile(signal: SignalRecord): SignalFrequencyProfile {
  return normalizeSignalFrequencyProfile({
    coreNeed: signal.coreNeed ?? signal.fingerprintJson.coreNeed ?? signal.fingerprintJson.hiddenNeed,
    emotionTone: signal.emotionTone ?? signal.fingerprintJson.emotionTone,
    fallbackText: [signal.seedText, signal.expandedText].join("\n"),
    innerConflict:
      signal.innerConflict ??
      signal.fingerprintJson.innerConflict ??
      signal.fingerprintJson.narrativeConflict,
    primaryBand: signal.primaryBand ?? signal.fingerprintJson.primaryBand,
    resonanceKeywords: signal.resonanceKeywords ?? signal.fingerprintJson.resonanceKeywords ?? signal.fingerprintJson.tags,
    subFeeling: signal.subFeeling ?? signal.fingerprintJson.subFeeling,
  });
}

export function getFingerprintFrequencyProfile(fingerprint: SignalFingerprint): SignalFrequencyProfile {
  return normalizeSignalFrequencyProfile({
    coreNeed: fingerprint.coreNeed ?? fingerprint.hiddenNeed,
    emotionTone: fingerprint.emotionTone ?? fingerprint.primaryEmotion,
    fallbackText: [
      fingerprint.title,
      fingerprint.theme,
      fingerprint.primaryEmotion,
      normalizeFingerprintTextList(fingerprint.tags, []).join("、"),
    ].join("\n"),
    innerConflict: fingerprint.innerConflict ?? fingerprint.narrativeConflict,
    primaryBand: fingerprint.primaryBand,
    resonanceKeywords: fingerprint.resonanceKeywords ?? fingerprint.tags,
    subFeeling: fingerprint.subFeeling,
  });
}

function normalizeFingerprintText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function normalizeFingerprintScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1)
    : fallback;
}

function normalizeFingerprintTextList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : fallback;
}

function getSignalResponseFingerprint(signal: SignalRecord): SignalFingerprint {
  const fingerprint = signal.fingerprintJson;
  const frequencyProfile = getSignalFrequencyProfile(signal);
  const tags = normalizeFingerprintTextList(
    fingerprint.tags,
    frequencyProfile.resonanceKeywords,
  );

  return {
    ...fingerprint,
    coreNeed: frequencyProfile.coreNeed,
    displayText: frequencyProfile.displayText,
    energy: normalizeFingerprintScore(fingerprint.energy, 0.5),
    emotionTone: frequencyProfile.emotionTone,
    frequency: normalizeFingerprintText(
      fingerprint.frequency,
      signal.authorFreqCode ?? "FM --.--",
    ),
    hiddenNeed: normalizeFingerprintText(fingerprint.hiddenNeed, frequencyProfile.coreNeed),
    innerConflict: frequencyProfile.innerConflict,
    narrativeConflict: normalizeFingerprintText(
      fingerprint.narrativeConflict,
      frequencyProfile.innerConflict,
    ),
    openness: normalizeFingerprintScore(fingerprint.openness, 0.5),
    primaryBand: frequencyProfile.primaryBand,
    primaryEmotion: normalizeFingerprintText(
      fingerprint.primaryEmotion,
      frequencyProfile.emotionTone,
    ),
    resonanceKeywords: frequencyProfile.resonanceKeywords,
    riskLevel: ["HIGH", "LOW", "MEDIUM"].includes(fingerprint.riskLevel)
      ? fingerprint.riskLevel
      : "LOW",
    secondaryEmotions: normalizeFingerprintTextList(fingerprint.secondaryEmotions, []),
    signalType: normalizeFingerprintText(fingerprint.signalType, frequencyProfile.primaryBand),
    subFeeling: frequencyProfile.subFeeling,
    tags,
    theme: normalizeFingerprintText(fingerprint.theme, frequencyProfile.displayText),
    title: normalizeFingerprintText(fingerprint.title, toShortText(signal.seedText, 24)),
  };
}


export function toSignalDetail(signal: SignalRecord): SignalDetail {
  const frequencyProfile = getSignalFrequencyProfile(signal);

  return {
    audioError: signal.audioError ?? undefined,
    audioStatus: signal.audioStatus,
    audioUrl: signal.audioUrl ?? undefined,
    audioUrlLeft: signal.audioUrlLeft ?? undefined,
    audioUrlRight: signal.audioUrlRight ?? undefined,
    authorFreqCode: signal.authorFreqCode ?? undefined,
    createdAt: signal.createdAt.toISOString(),
    echoCount: signal.echoCount,
    expandedText: signal.expandedText,
    fingerprint: getSignalResponseFingerprint(signal),
    followUpQuestion: signal.followUpQuestion ?? undefined,
    frequencyProfile,
    frequencyId: signal.frequencyId ?? undefined,
    galaxyPosition: signal.galaxyPosition ?? undefined,
    guestKey: signal.guestKey ?? undefined,
    id: signal.id,
    matchSignalId: signal.matchSignalId ?? undefined,
    matches: [],
    parentSignalId: signal.parentSignalId ?? undefined,
    program: signal.programJson,
    qualityReason: signal.qualityReason ?? undefined,
    qualityScore: signal.qualityScore ?? undefined,
    rawInput: signal.rawInput,
    resonanceCount: signal.resonanceCount,
    seedText: signal.seedText,
    source: signal.source,
    status: signal.status,
    isKept: signal.isKept,
    updatedAt: signal.updatedAt.toISOString(),
  };
}

export function toSignalPreviewDetail(signal: SignalRecord): SignalPreviewDetail {
  return {
    ...toSignalDetail(signal),
    status: "DRAFT",
    visibility: "PREVIEW_OWNER",
  };
}

export function toSignalGenerationDetail(signal: SignalRecord): SignalGenerationDetail {
  return {
    createdAt: signal.createdAt.toISOString(),
    generationError: signal.generationStatus === "FAILED"
      ? "这句种子暂时没有发出。可以重新发射。"
      : undefined,
    generationStatus: signal.generationStatus,
    id: signal.id,
    parentSignalId: signal.parentSignalId ?? undefined,
    seedText: signal.seedText,
    status: signal.status,
    updatedAt: signal.updatedAt.toISOString(),
    visibility: "GENERATION_OWNER",
  };
}

export function buildMinimalSignalProgram(params: {
  expandedText: string;
  fingerprint: SignalFingerprint;
  match?: SignalMatchSummary;
  rawInput: string;
}): SignalProgram {
  const title = toShortText(params.rawInput, 24);
  const frequency = params.fingerprint.frequency;

  return {
    bridgeNarration:
      params.match === undefined
        ? "一条生活信号，暂未匹配到公开同频。"
        : "一条生活信号，已找到相近同频。",
    closingQuestion: "还想补一个细节吗？",
    hostIntro: `来自 ${frequency} 的一条生活信号。`,
    leftSignalSummary: toShortText(params.expandedText, 120),
    programTitle: title.length > 0 ? title : frequency,
    ...(params.match === undefined
      ? {}
      : { rightSignalSummary: toShortText(params.match.expandedText, 120) }),
    shareQuote: toShortText(params.rawInput, 80),
  };
}

export function withSaveState(detail: SignalDetail, hasSaved?: boolean): SignalDetail {
  return hasSaved === undefined
    ? detail
    : {
        ...detail,
        hasSaved,
      };
}

export function toMySignalSummary(signal: SignalRecord): MySignalSummary {
  return {
    createdAt: signal.createdAt.toISOString(),
    expandedText: signal.expandedText,
    frequencyProfile: getSignalFrequencyProfile(signal),
    id: signal.id,
    parentSignalId: signal.parentSignalId ?? undefined,
    resonanceCount: signal.resonanceCount,
    seedText: signal.seedText,
    status: signal.status,
  };
}

export function toSavedSignalSummary(signal: SavedSignalRecord): SavedSignalSummary {
  const frequencyProfile = getSignalFrequencyProfile(signal);

  return {
    ...toMySignalSummary(signal),
    authorFreqCode: signal.authorFreqCode ?? undefined,
    frequencyProfile,
    savedAt: signal.savedAt.toISOString(),
    theme: frequencyProfile.displayText,
  };
}

export function sumResonanceCount(signals: MySignalSummary[]): number {
  return signals.reduce((total, signal) => total + signal.resonanceCount, 0);
}

export function toSignalAudioDetail(signal: SignalRecord): SignalAudioDetail {
  return {
    audioError: signal.audioError ?? undefined,
    audioStatus: signal.audioStatus,
    audioUrl: signal.audioUrl ?? undefined,
    audioUrlLeft: signal.audioUrlLeft ?? undefined,
    audioUrlRight: signal.audioUrlRight ?? undefined,
    signalId: signal.id,
  };
}

export function toUnavailableTtsAudioDetail(signal: SignalRecord): SignalAudioDetail {
  return {
    ...toSignalAudioDetail(signal),
    audioError: signal.audioError ?? "TTS provider is not configured.",
    audioStatus: "FAILED",
  };
}

export function toMatchSummary(signal: SignalRecord, score: number): SignalMatchSummary {
  const frequencyProfile = getSignalFrequencyProfile(signal);
  const fingerprint = getSignalResponseFingerprint(signal);

  return {
    expandedText: signal.expandedText,
    frequencyProfile,
    frequencyCode: signal.authorFreqCode ?? fingerprint.frequency,
    id: signal.id,
    primaryEmotion: fingerprint.primaryEmotion,
    resonanceCount: signal.resonanceCount,
    score,
    seedText: signal.seedText,
    signalType: fingerprint.signalType,
    source: "PUBLISHED",
    summary: toShortText(signal.expandedText, 96),
    tags: fingerprint.tags.slice(0, 8),
    title: fingerprint.title,
  };
}

export function toSemanticMatchSummary(signal: SignalSemanticMatchRecord): SignalMatchSummary {
  const distance = Math.max(0, signal.distance);

  return {
    ...toMatchSummary(signal, Number(((1 / (1 + distance)) * 100).toFixed(4))),
    distance: Number(distance.toFixed(6)),
  };
}

export function isFiniteGalaxyPosition(
  value: SignalGalaxyPosition | null | undefined,
): value is SignalGalaxyPosition {
  return (
    value !== null &&
    value !== undefined &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

function hashToUnitVector(value: string): SignalGalaxyPosition {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const theta = (((hash >>> 0) % 3600) / 3600) * Math.PI * 2;
  const phi = ((((hash >>> 9) % 1800) / 1800) - 0.5) * Math.PI;
  const radius = 0.42 + (((hash >>> 18) % 1000) / 1000) * 0.56;
  const cosPhi = Math.cos(phi);

  return {
    x: Number((Math.cos(theta) * cosPhi * radius).toFixed(6)),
    y: Number((Math.sin(phi) * radius).toFixed(6)),
    z: Number((Math.sin(theta) * cosPhi * radius).toFixed(6)),
  };
}

export function buildStableGalaxyPosition(signal: SignalRecord): SignalGalaxyPosition {
  if (isFiniteGalaxyPosition(signal.galaxyPosition)) {
    return signal.galaxyPosition;
  }

  return hashToUnitVector(
    [
      signal.embeddingVersion ?? "fallback",
      signal.id,
      signal.fingerprintJson.signalType,
      signal.fingerprintJson.primaryEmotion,
      signal.expandedText,
    ].join(":"),
  );
}

export function buildInitialGalaxyPosition(params: {
  embeddingVersion?: string;
  expandedText: string;
  fingerprint: SignalFingerprint;
  signalId: string;
}): SignalGalaxyPosition {
  return hashToUnitVector(
    [
      params.embeddingVersion ?? "fallback",
      params.signalId,
      params.fingerprint.signalType,
      params.fingerprint.primaryEmotion,
      params.expandedText,
    ].join(":"),
  );
}

export function toSignalEchoDetail(echo: SignalEchoRecord): SignalEchoDetail {
  return {
    authorFreqCode: echo.authorFreqCode ?? undefined,
    content: echo.content,
    createdAt: echo.createdAt.toISOString(),
    guestKey: echo.guestKey ?? undefined,
    id: echo.id,
    signalId: echo.signalId,
    status: echo.status,
  };
}
