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
  GalaxyCoverage,
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

const exactKeys = (value: UnknownRecord, required: string[], optional: string[] = []) =>
  required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const isPublicContent = (value: unknown): value is UnknownRecord => isRecord(value) &&
  isString(value.expandedText) && value.expandedText.trim().length > 0 &&
  isOptional(value.authorFreqCode, (code) => isString(code) && /^FM[ -]\d{2}\.\d{2}$/u.test(code)) &&
  isStringArray(value.tags) && value.tags.length <= 3 && new Set(value.tags).size === value.tags.length &&
  value.tags.every((tag) => tag.length > 0 && tag.length <= 16 && tag === tag.trim()) &&
  isOptional(value.primaryBand, (band) => isEnumValue(band, signalPrimaryBands) && isStringArray(value.tags) && value.tags.includes(publicBandLabels[String(band)]));
const publicBandLabels: Record<string, string> = { self_mirror: "自我镜像", emotional_undercurrent: "情绪暗流", relationship_nebula: "关系星云", time_ring: "时间星环", meaning_deep_space: "意义深空", stagnant_orbit: "停滞轨道", era_cluster: "时代星群" };
const publicContentKeys = ["expandedText", "tags"];
const publicContentOptionalKeys = ["authorFreqCode", "primaryBand"];
export const isPublicationPreview = (value: unknown): value is import("@unfreq/contracts").SignalPublicationPreview =>
  isRecord(value) && exactKeys(value, ["content", "digest", "version"]) && isPublicContent(value.content) &&
  exactKeys(value.content, publicContentKeys, publicContentOptionalKeys) && isString(value.digest) && /^[a-f0-9]{64}$/u.test(value.digest) && isVersion(value.version);
const isPublicationActions = (value: unknown): boolean => isRecord(value) &&
  exactKeys(value, ["canPublish", "canWithdraw", "state", "version"], ["preview", "publishedContent"]) &&
  isBoolean(value.canPublish) && isBoolean(value.canWithdraw) && isVersion(value.version) &&
  isEnumValue(value.state, ["DRAFT", "PUBLIC", "WITHDRAWN", "REVIEWING", "HIDDEN", "DELETED", "GENERATING", "FAILED", "UNCONFIRMED"]) &&
  isOptional(value.preview, (preview) => isPublicationPreview(preview) && preview.version === value.version) &&
  (!value.canPublish || isPublicationPreview(value.preview)) && isOptional(value.publishedContent, (content) =>
    isPublicContent(content) && exactKeys(content, publicContentKeys, publicContentOptionalKeys));
const isSignalMatchSummary = (value: unknown): boolean => isPublicContent(value) &&
  exactKeys(value, [...publicContentKeys, "id", "score", "source", "resonanceCount", "publicationVersion"], publicContentOptionalKeys) &&
  isString(value.id) && isFiniteNumber(value.score) && value.score >= 0 && value.source === "PUBLISHED" &&
  isNonNegativeInteger(value.resonanceCount) && isVersion(value.publicationVersion) && value.publicationVersion > 0;
export const isPublicSignalDetail = (value: unknown): value is import("@unfreq/contracts").PublicSignalDetail =>
  isPublicContent(value) && exactKeys(value, [...publicContentKeys, "id", "createdAt", "updatedAt", "publishedAt", "publicationVersion", "status", "visibility", "echoCount", "resonanceCount", "source", "matches"], [...publicContentOptionalKeys, "hasSaved"]) &&
  isString(value.id) && isString(value.createdAt) && isString(value.updatedAt) && isString(value.publishedAt) &&
  isVersion(value.publicationVersion) && value.publicationVersion > 0 && value.status === "PUBLISHED" && value.visibility === "PUBLIC" &&
  isNonNegativeInteger(value.echoCount) && isNonNegativeInteger(value.resonanceCount) && isEnumValue(value.source, signalSources) &&
  isOptional(value.hasSaved, isBoolean) && Array.isArray(value.matches) && value.matches.every(isSignalMatchSummary);

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

const isReviewingSignalRestrictedDetail = (value: unknown): boolean => isRecord(value) &&
  exactKeys(value, ["id", "status", "visibility", "createdAt", "updatedAt"]) && value.status === "REVIEWING" && value.visibility === "REVIEW_RESTRICTED" &&
  isString(value.id) && isString(value.createdAt) && isString(value.updatedAt);
const isOwnerSignalDetail = (value: unknown): boolean => isSignalDetail(value) && isRecord(value) &&
  value.visibility === "PRIVATE_OWNER" && isPublicationActions(value.publication);

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
    isOptional(value.publication, isPublicationActions) &&
    value.visibility === "GENERATION_OWNER"
  );
};

const isGalaxyPoint = (value: unknown): boolean => isPublicContent(value) &&
  exactKeys(value, [...publicContentKeys, "id", "createdAt", "publicationVersion", "position", "source", "isMine", "matchIds", "resonanceCount"], publicContentOptionalKeys) &&
  isString(value.id) && isString(value.createdAt) && isVersion(value.publicationVersion) && value.publicationVersion > 0 &&
  isSignalPosition(value.position) && isEnumValue(value.source, signalSources) && isBoolean(value.isMine) && isStringArray(value.matchIds) && isNonNegativeInteger(value.resonanceCount);

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
    isOptional(value.publicationState, (state) => isEnumValue(state, ["DRAFT", "PUBLIC", "WITHDRAWN", "REVIEWING", "HIDDEN", "DELETED", "GENERATING", "FAILED", "UNCONFIRMED"])) &&
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

const isSavedSignalSummary = (value: unknown): boolean => isPublicContent(value) &&
  exactKeys(value, [...publicContentKeys, "id", "createdAt", "savedAt", "publicationVersion", "status", "resonanceCount", "source"], publicContentOptionalKeys) &&
  isString(value.id) && isString(value.createdAt) && isString(value.savedAt) && isVersion(value.publicationVersion) && value.publicationVersion > 0 &&
  value.status === "PUBLISHED" && isNonNegativeInteger(value.resonanceCount) && isEnumValue(value.source, signalSources);

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
      isReviewingSignalRestrictedDetail(value.signal) ||
      isPublicSignalDetail(value.signal) ||
      isOwnerSignalDetail(value.signal) ||
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
    isOwnerSignalDetail(value.signal) &&
    value.signal.status === "PUBLISHED"
  );
};

export const isSignalHallResponse = (value: unknown): value is SignalHallResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.signals) &&
    value.signals.every(isPublicSignalDetail)
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
    isOptional(value.coverage, (coverage): coverage is GalaxyCoverage => {
      if (!isRecord(coverage) || !isRecord(coverage.filters) || !Array.isArray(value.points)) return false;
      return exactKeys(coverage, ["totalEligibleCount", "returnedCount", "sampleLimit", "samplingVersion", "filters", "focusStatus"], ["latestOwnSignalId", "focusSignalId"]) &&
        exactKeys(coverage.filters, [], ["band", "theme"]) &&
        isOptional(coverage.filters.band, (band) => isEnumValue(band, signalPrimaryBands)) && isOptional(coverage.filters.theme, isString) &&
        isNonNegativeInteger(coverage.totalEligibleCount) && Number.isSafeInteger(coverage.totalEligibleCount) && isNonNegativeInteger(coverage.returnedCount) &&
        coverage.returnedCount === value.points.length && coverage.totalEligibleCount >= coverage.returnedCount &&
        coverage.sampleLimit === 80 && coverage.returnedCount <= 80 && coverage.samplingVersion === "recent-band-v1" &&
        isEnumValue(coverage.focusStatus, ["none", "available", "unavailable"]) &&
        (coverage.latestOwnSignalId === undefined || value.points.some((point) => isRecord(point) && point.id === coverage.latestOwnSignalId && point.isMine === true)) &&
        (coverage.focusStatus === "available" ? isString(coverage.focusSignalId) && value.points.some((point) => isRecord(point) && point.id === coverage.focusSignalId) : coverage.focusSignalId === undefined);
    }) &&
    isOptional(value.themeOptions, isStringArray)
  );
};

export const isMySignalsResponse = (value: unknown): value is MySignalsResponse => {
  return (
    isRecord(value) &&
    Array.isArray(value.signals) &&
    value.signals.length <= 80 &&
    value.signals.every(isMySignalSummary) &&
    isNonNegativeInteger(value.totalResonanceCount) &&
    isOptional(value.totalSignalCount, isNonNegativeInteger) &&
    (value.totalSignalCount === undefined || (typeof value.totalSignalCount === "number" && value.totalSignalCount >= value.signals.length)) &&
    isOptional(value.topSignal, isMySignalSummary) &&
    isOptional(value.page, (page) => isRecord(page) && isNonNegativeInteger(page.limit) && page.limit >= (value.signals as unknown[]).length && page.limit >= 1 && page.limit <= 80 &&
      isBoolean(page.hasMore) && (page.hasMore ? typeof page.nextCursor === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(page.nextCursor) : page.nextCursor === undefined))
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
