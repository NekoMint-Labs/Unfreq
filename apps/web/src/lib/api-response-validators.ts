import {
  signalGenerationStatuses,
  signalPrimaryBands,
  signalSubFeelings,
} from "@unfreq/contracts";
import type {
  CreateSignalEchoResponse,
  CreateSignalResponse,
  EchoSummaryResponse,
  GalaxyResponse,
  MeResponse,
  MySignalsResponse,
  PublishSignalResponse,
  SavedSignalsResponse,
  SignalAudioResponse,
  SignalEchoesResponse,
  SignalHallResponse,
  SignalMatchesResponse,
  SignalResonanceResponse,
  SignalResponse,
  SignalSaveResponse,
} from "@unfreq/contracts";

type UnknownRecord = Record<string, unknown>;

const signalSources = ["ai_generated", "human", "seed"] as const;
const signalStatuses = ["DELETED", "DRAFT", "HIDDEN", "PUBLISHED", "REVIEWING"] as const;
const signalEchoStatuses = ["DELETED", "HIDDEN", "PUBLISHED", "REVIEWING"] as const;
const signalAudioStatuses = ["FAILED", "NOT_REQUESTED", "PENDING", "READY"] as const;
const signalRiskLevels = ["HIGH", "LOW", "MEDIUM"] as const;
const signalMatchSources = ["FALLBACK", "PUBLISHED", "SEEDED"] as const;
const frequencyRoles = ["ADMIN", "USER"] as const;
const frequencyStatuses = ["ACTIVE", "BANNED", "MUTED"] as const;

const isRecord = (value: unknown): value is UnknownRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isString = (value: unknown): value is string => {
  return typeof value === "string";
};

const isBoolean = (value: unknown): value is boolean => {
  return typeof value === "boolean";
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const isNonNegativeInteger = (value: unknown): value is number => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every(isString);
};

const isEnumValue = <TValue extends string>(
  value: unknown,
  values: readonly TValue[],
): value is TValue => {
  return isString(value) && values.includes(value as TValue);
};

const isOptional = <TValue>(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
): value is TValue | undefined => {
  return value === undefined || predicate(value);
};

const isFrequencyProfile = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.coreNeed) &&
    isString(value.displayText) &&
    isString(value.emotionTone) &&
    isString(value.innerConflict) &&
    isEnumValue(value.primaryBand, signalPrimaryBands) &&
    isStringArray(value.resonanceKeywords) &&
    value.resonanceKeywords.length >= 1 &&
    value.resonanceKeywords.length <= 3 &&
    isEnumValue(value.subFeeling, signalSubFeelings)
  );
};

const isSignalFingerprint = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.coreNeed) &&
    isString(value.displayText) &&
    isFiniteNumber(value.energy) &&
    value.energy >= 0 &&
    value.energy <= 1 &&
    isString(value.emotionTone) &&
    isString(value.frequency) &&
    isString(value.hiddenNeed) &&
    isString(value.innerConflict) &&
    isString(value.narrativeConflict) &&
    isFiniteNumber(value.openness) &&
    value.openness >= 0 &&
    value.openness <= 1 &&
    isString(value.primaryEmotion) &&
    isEnumValue(value.primaryBand, signalPrimaryBands) &&
    isStringArray(value.resonanceKeywords) &&
    value.resonanceKeywords.length >= 1 &&
    value.resonanceKeywords.length <= 3 &&
    isEnumValue(value.riskLevel, signalRiskLevels) &&
    isStringArray(value.secondaryEmotions) &&
    isString(value.signalType) &&
    isEnumValue(value.subFeeling, signalSubFeelings) &&
    isStringArray(value.tags) &&
    isString(value.theme) &&
    isString(value.title)
  );
};

const isSignalProgram = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.bridgeNarration) &&
    isString(value.closingQuestion) &&
    isString(value.hostIntro) &&
    isString(value.leftSignalSummary) &&
    isString(value.programTitle) &&
    isOptional(value.rightSignalSummary, isString) &&
    isString(value.shareQuote)
  );
};

const isSignalPosition = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
};

const isSignalMatchSummary = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isOptional(value.distance, isFiniteNumber) &&
    isString(value.expandedText) &&
    isFrequencyProfile(value.frequencyProfile) &&
    isString(value.frequencyCode) &&
    isString(value.id) &&
    isString(value.primaryEmotion) &&
    isNonNegativeInteger(value.resonanceCount) &&
    isFiniteNumber(value.score) &&
    value.score >= 0 &&
    isOptional(value.seedText, isString) &&
    isString(value.signalType) &&
    isEnumValue(value.source, signalMatchSources) &&
    isString(value.summary) &&
    isStringArray(value.tags) &&
    isString(value.title)
  );
};

const isSignalDetail = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isOptional(value.audioError, isString) &&
    isEnumValue(value.audioStatus, signalAudioStatuses) &&
    isOptional(value.audioUrl, isString) &&
    isOptional(value.audioUrlLeft, isString) &&
    isOptional(value.audioUrlRight, isString) &&
    isOptional(value.authorFreqCode, isString) &&
    isString(value.createdAt) &&
    isNonNegativeInteger(value.echoCount) &&
    isString(value.expandedText) &&
    isSignalFingerprint(value.fingerprint) &&
    isOptional(value.followUpQuestion, isString) &&
    isFrequencyProfile(value.frequencyProfile) &&
    isOptional(value.frequencyId, isString) &&
    isOptional(value.galaxyPosition, isSignalPosition) &&
    isOptional(value.guestKey, isString) &&
    isString(value.id) &&
    isOptional(value.matchSignalId, isString) &&
    Array.isArray(value.matches) &&
    value.matches.every(isSignalMatchSummary) &&
    isOptional(value.parentSignalId, isString) &&
    isSignalProgram(value.program) &&
    isOptional(value.qualityReason, isString) &&
    isOptional(value.qualityScore, (candidate) => {
      return typeof candidate === "number" &&
        Number.isInteger(candidate) &&
        candidate >= 1 &&
        candidate <= 5;
    }) &&
    isString(value.rawInput) &&
    isNonNegativeInteger(value.resonanceCount) &&
    isString(value.seedText) &&
    isEnumValue(value.source, signalSources) &&
    isEnumValue(value.status, signalStatuses) &&
    isBoolean(value.isKept) &&
    isOptional(value.hasSaved, isBoolean) &&
    isString(value.updatedAt)
  );
};

const isReviewingSignalRestrictedDetail = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    isString(value.id) &&
    value.status === "REVIEWING" &&
    isString(value.updatedAt) &&
    value.visibility === "REVIEW_RESTRICTED"
  );
};

const isSignalPreviewDetail = (value: unknown): boolean => {
  return (
    isSignalDetail(value) &&
    isRecord(value) &&
    value.status === "DRAFT" &&
    value.visibility === "PREVIEW_OWNER"
  );
};

const isSignalGenerationDetail = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    isOptional(value.generationError, isString) &&
    isEnumValue(value.generationStatus, signalGenerationStatuses) &&
    isString(value.id) &&
    isOptional(value.parentSignalId, isString) &&
    isString(value.seedText) &&
    isEnumValue(value.status, signalStatuses) &&
    isString(value.updatedAt) &&
    value.visibility === "GENERATION_OWNER"
  );
};

const isGalaxyPoint = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    isString(value.expandedText) &&
    isFrequencyProfile(value.frequencyProfile) &&
    isString(value.frequencyCode) &&
    isString(value.id) &&
    isBoolean(value.isMine) &&
    isStringArray(value.matchIds) &&
    isSignalPosition(value.position) &&
    isNonNegativeInteger(value.resonanceCount) &&
    isEnumValue(value.source, signalSources) &&
    isString(value.theme)
  );
};

const isBandOption = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.label) &&
    isEnumValue(value.value, signalPrimaryBands)
  );
};

const isSignalAudioDetail = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isOptional(value.audioError, isString) &&
    isEnumValue(value.audioStatus, signalAudioStatuses) &&
    isOptional(value.audioUrl, isString) &&
    isOptional(value.audioUrlLeft, isString) &&
    isOptional(value.audioUrlRight, isString) &&
    isString(value.signalId)
  );
};

const isSignalEchoDetail = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isOptional(value.authorFreqCode, isString) &&
    isString(value.content) &&
    isString(value.createdAt) &&
    isOptional(value.guestKey, isString) &&
    isString(value.id) &&
    isString(value.signalId) &&
    isEnumValue(value.status, signalEchoStatuses)
  );
};

const isMySignalSummary = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    isString(value.expandedText) &&
    isFrequencyProfile(value.frequencyProfile) &&
    isString(value.id) &&
    isOptional(value.parentSignalId, isString) &&
    isNonNegativeInteger(value.resonanceCount) &&
    isString(value.seedText) &&
    isEnumValue(value.status, signalStatuses)
  );
};

const isSavedSignalSummary = (value: unknown): boolean => {
  return (
    isMySignalSummary(value) &&
    isRecord(value) &&
    isOptional(value.authorFreqCode, isString) &&
    isString(value.savedAt) &&
    isString(value.theme)
  );
};

const isFrequencyIdentity = (value: unknown): boolean => {
  return (
    isRecord(value) &&
    isOptional(value.code, isString) &&
    isString(value.createdAt) &&
    isOptional(value.frequencyName, isString) &&
    isString(value.freqCode) &&
    isString(value.id) &&
    isOptional(value.isGuest, isBoolean) &&
    isOptional(value.lastSeenAt, isString) &&
    isEnumValue(value.role, frequencyRoles) &&
    isEnumValue(value.status, frequencyStatuses)
  );
};

export const isMeResponse = (value: unknown): value is MeResponse => {
  return isRecord(value) && isFrequencyIdentity(value.frequency);
};

export const isSignalResponse = (value: unknown): value is SignalResponse => {
  return (
    isRecord(value) &&
    (
      isSignalDetail(value.signal) ||
      isSignalPreviewDetail(value.signal) ||
      isReviewingSignalRestrictedDetail(value.signal) ||
      isSignalGenerationDetail(value.signal)
    )
  );
};

export const isCreateSignalResponse = (value: unknown): value is CreateSignalResponse => {
  return isRecord(value) && isSignalGenerationDetail(value.signal);
};

export const isPublishSignalResponse = (value: unknown): value is PublishSignalResponse => {
  return (
    isRecord(value) &&
    isRecord(value.signal) &&
    isSignalDetail(value.signal) &&
    value.signal.status === "PUBLISHED"
  );
};

export const isSignalHallResponse = (value: unknown): value is SignalHallResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.signals) &&
    value.signals.every(isSignalDetail)
  );
};

export const isGalaxyResponse = (value: unknown): value is GalaxyResponse => {
  return (
    isRecord(value) &&
    isOptional(value.bandOptions, (candidate): candidate is GalaxyResponse["bandOptions"] => {
      return Array.isArray(candidate) && candidate.every(isBandOption);
    }) &&
    isString(value.generatedAt) &&
    Array.isArray(value.points) &&
    value.points.every(isGalaxyPoint) &&
    isOptional(value.themeOptions, isStringArray)
  );
};

export const isMySignalsResponse = (value: unknown): value is MySignalsResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.signals) &&
    value.signals.every(isMySignalSummary) &&
    isNonNegativeInteger(value.totalResonanceCount)
  );
};

export const isEchoSummaryResponse = (value: unknown): value is EchoSummaryResponse => {
  if (!isRecord(value) || !isRecord(value.summary)) {
    return false;
  }

  return (
    isString(value.summary.frequencyId) &&
    isNonNegativeInteger(value.summary.newResonanceCount) &&
    isOptional(value.summary.since, isString) &&
    isOptional(value.summary.topSignal, isMySignalSummary) &&
    isNonNegativeInteger(value.summary.totalResonanceCount)
  );
};

export const isSavedSignalsResponse = (value: unknown): value is SavedSignalsResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.signals) &&
    value.signals.every(isSavedSignalSummary)
  );
};

export const isSignalAudioResponse = (value: unknown): value is SignalAudioResponse => {
  return isRecord(value) && isSignalAudioDetail(value.audio);
};

export const isSignalMatchesResponse = (
  value: unknown,
): value is SignalMatchesResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.matches) &&
    value.matches.every(isSignalMatchSummary)
  );
};

export const isSignalEchoesResponse = (value: unknown): value is SignalEchoesResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.echoes) &&
    value.echoes.every(isSignalEchoDetail)
  );
};

export const isCreateSignalEchoResponse = (
  value: unknown,
): value is CreateSignalEchoResponse => {
  return isRecord(value) && isSignalEchoDetail(value.echo);
};

export const isSignalResonanceResponse = (
  value: unknown,
): value is SignalResonanceResponse => {
  return (
    isRecord(value) &&
    isRecord(value.resonance) &&
    isBoolean(value.resonance.hasResonated) &&
    isNonNegativeInteger(value.resonance.resonanceCount)
  );
};

export const isSignalSaveResponse = (value: unknown): value is SignalSaveResponse => {
  return isRecord(value) && isRecord(value.save) && isBoolean(value.save.hasSaved);
};
