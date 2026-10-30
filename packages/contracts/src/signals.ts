import type { OwnerSignalDetail, PublicSignalDetail, PublicSignalMatchSummary, PublicGalaxySignalPoint, PublicSavedSignalSummary } from "./signal-publication.js";
export { maxSignalPublicationVersion } from "./signal-publication.js";
export type {
  PublishSignalRequest,
  WithdrawSignalRequest,
  WithdrawSignalResponse,
  OwnerSignalDetail,
  PublicGalaxySignalPoint,
  PublicSavedSignalSummary,
  PublicSignalDetail,
  PublicSignalMatchSummary,
  SignalPublicationActions,
  SignalPublicationPreview,
  SignalPublicationSnapshot,
  SignalPublicContent,
} from "./signal-publication.js";

export const signalPrimaryBands = [
  "self_mirror",
  "emotional_undercurrent",
  "relationship_nebula",
  "time_ring",
  "meaning_deep_space",
  "stagnant_orbit",
  "era_cluster",
] as const;

export type SignalPrimaryBand = (typeof signalPrimaryBands)[number];

export const signalSubFeelings = [
  "self_doubt",
  "identity_confusion",
  "self_acceptance",
  "fatigue",
  "anxiety",
  "numbness",
  "loneliness",
  "need_to_be_understood",
  "relationship_disappointment",
  "growth_anxiety",
  "nostalgia",
  "future_uncertainty",
  "effort_doubt",
  "goal_loss",
  "existential_questioning",
  "procrastination",
  "starting_difficulty",
  "fear_of_failure",
  "efficiency_anxiety",
  "work_alienation",
  "modern_loneliness",
] as const;

export type SignalSubFeeling = (typeof signalSubFeelings)[number];

export type SignalStatus = "DELETED" | "DRAFT" | "HIDDEN" | "PUBLISHED" | "REVIEWING";
export const signalGenerationStatuses = [
  "RECEIVED",
  "EXPANDING",
  "MATCHING",
  "WRITING",
  "COMPLETED",
  "FAILED",
] as const;
export type SignalGenerationStatus = (typeof signalGenerationStatuses)[number];
export type SignalAudioStatus = "FAILED" | "NOT_REQUESTED" | "PENDING" | "READY";
export type SignalSource = "ai_generated" | "human" | "seed";
export type SignalRiskLevel = "HIGH" | "LOW" | "MEDIUM";
export type SignalMatchSource = "FALLBACK" | "PUBLISHED" | "SEEDED";

export type SignalFrequencyProfile = {
  coreNeed: string;
  displayText: string;
  emotionTone: string;
  innerConflict: string;
  primaryBand: SignalPrimaryBand;
  resonanceKeywords: string[];
  subFeeling: SignalSubFeeling;
};

export type SignalFingerprint = {
  coreNeed: string;
  displayText: string;
  energy: number;
  emotionTone: string;
  frequency: string;
  hiddenNeed: string;
  innerConflict: string;
  narrativeConflict: string;
  openness: number;
  primaryBand: SignalPrimaryBand;
  primaryEmotion: string;
  resonanceKeywords: string[];
  riskLevel: SignalRiskLevel;
  secondaryEmotions: string[];
  signalType: string;
  subFeeling: SignalSubFeeling;
  tags: string[];
  theme: string;
  title: string;
};

export type SignalProgram = {
  bridgeNarration: string;
  closingQuestion: string;
  hostIntro: string;
  leftSignalSummary: string;
  programTitle: string;
  rightSignalSummary?: string;
  shareQuote: string;
};

export type SignalGalaxyPosition = {
  x: number;
  y: number;
  z: number;
};

export type GalaxySignalPoint = PublicGalaxySignalPoint;

export type GalaxyCoverage = {
  totalEligibleCount: number;
  returnedCount: number;
  sampleLimit: 80;
  samplingVersion: "recent-band-v1";
  filters: { band?: SignalPrimaryBand; theme?: string };
  latestOwnSignalId?: string;
  focusSignalId?: string;
  focusStatus: "none" | "available" | "unavailable";
};

export type GalaxyResponse = {
  coverage?: GalaxyCoverage;
  bandOptions?: Array<{
    label: string;
    value: SignalPrimaryBand;
  }>;
  generatedAt: string;
  points: PublicGalaxySignalPoint[];
  themeOptions?: string[];
};

export type GalaxyResult = {
  coverage: GalaxyCoverage;
  bandOptions: Array<{
    label: string;
    value: SignalPrimaryBand;
  }>;
  generatedAt: string;
  points: PublicGalaxySignalPoint[];
  themeOptions: string[];
};

export type SignalMatchSummary = {
  publicationVersion?: number;
  distance?: number;
  expandedText: string;
  frequencyProfile: SignalFrequencyProfile;
  frequencyCode: string;
  id: string;
  primaryEmotion: string;
  resonanceCount: number;
  score: number;
  seedText?: string;
  signalType: string;
  source: SignalMatchSource;
  summary: string;
  tags: string[];
  title: string;
};

export type SignalDetail = {
  audioError?: string;
  audioStatus: SignalAudioStatus;
  audioUrl?: string;
  audioUrlLeft?: string;
  audioUrlRight?: string;
  authorFreqCode?: string;
  createdAt: string;
  echoCount: number;
  expandedText: string;
  fingerprint: SignalFingerprint;
  followUpQuestion?: string;
  frequencyProfile: SignalFrequencyProfile;
  frequencyId?: string;
  galaxyPosition?: SignalGalaxyPosition;
  guestKey?: string;
  id: string;
  matchSignalId?: string;
  matches: SignalMatchSummary[];
  parentSignalId?: string;
  program: SignalProgram;
  qualityReason?: string;
  qualityScore?: number;
  rawInput: string;
  resonanceCount: number;
  seedText: string;
  source: SignalSource;
  status: SignalStatus;
  isKept: boolean;
  hasSaved?: boolean;
  updatedAt: string;
};

export type SignalDetailPage = {
  hasNextPage: boolean;
  items: SignalDetail[];
  limit: number;
  nextCursor?: string;
  total: number;
};

export type ReviewingSignalRestrictedDetail = {
  createdAt: string;
  id: string;
  status: "REVIEWING";
  updatedAt: string;
  visibility: "REVIEW_RESTRICTED";
};

export type SignalPreviewDetail = Omit<SignalDetail, "status"> & {
  status: "DRAFT";
  visibility: "PREVIEW_OWNER";
};

export type SignalGenerationDetail = {
  createdAt: string;
  generationError?: string;
  generationStatus: SignalGenerationStatus;
  id: string;
  parentSignalId?: string;
  seedText: string;
  status: SignalStatus;
  updatedAt: string;
  publication?: import("./signal-publication.js").SignalPublicationActions;
  visibility: "GENERATION_OWNER";
};

export type SignalResultDetail = OwnerSignalDetail | PublicSignalDetail | SignalGenerationDetail | ReviewingSignalRestrictedDetail;

export type CreateSignalResponse = {
  signal: SignalGenerationDetail;
};

export type PublishSignalResponse = {
  signal: OwnerSignalDetail;
};

export type SignalAudioDetail = {
  audioError?: string;
  audioStatus: SignalAudioStatus;
  audioUrl?: string;
  audioUrlLeft?: string;
  audioUrlRight?: string;
  signalId: string;
};

export type SignalAudioResponse = {
  audio: SignalAudioDetail;
};

export type SignalMatchesResponse = {
  matches: PublicSignalMatchSummary[];
};

export type SignalEchoStatus = "DELETED" | "HIDDEN" | "PUBLISHED" | "REVIEWING";

export type SignalEchoDetail = {
  authorFreqCode?: string;
  content: string;
  createdAt: string;
  guestKey?: string;
  id: string;
  signalId: string;
  status: SignalEchoStatus;
};

export type SignalResponse = {
  signal: SignalResultDetail;
};

export type SignalHallResponse = {
  signals: PublicSignalDetail[];
};

export type SignalEchoesResponse = {
  echoes: SignalEchoDetail[];
};

export type CreateSignalEchoResponse = {
  echo: SignalEchoDetail;
};

export type SignalResonanceResult = {
  hasResonated: boolean;
  resonanceCount: number;
};

export type SignalResonanceResponse = {
  resonance: SignalResonanceResult;
};

export type SignalSaveResult = {
  hasSaved: boolean;
};

export type SignalSaveResponse = {
  save: SignalSaveResult;
};

export type MySignalSummary = {
  publicationState?: import("./signal-publication.js").SignalPublicationActions["state"];
  createdAt: string;
  expandedText: string;
  frequencyProfile: SignalFrequencyProfile;
  id: string;
  parentSignalId?: string;
  resonanceCount: number;
  seedText: string;
  status: SignalStatus;
};

export type MySignalsResult = {
  signals: MySignalSummary[];
  totalResonanceCount: number;
  totalSignalCount?: number;
  topSignal?: MySignalSummary;
  page?: { limit: number; hasMore: boolean; nextCursor?: string };
};

export type MySignalsResponse = MySignalsResult;

export type EchoSummary = {
  frequencyId: string;
  newResonanceCount: number;
  since?: string;
  topSignal?: MySignalSummary;
  totalResonanceCount: number;
};

export type EchoSummaryResponse = {
  summary: EchoSummary;
};

export type MonthlyRecap = {
  createdAt: string;
  frequencyId: string;
  generatedAt: string;
  id: string;
  signalCount: number;
  summary: string;
  themeWords: string[];
  topSignal?: MySignalSummary;
  totalResonanceCount: number;
  updatedAt: string;
  yearMonth: string;
};

export type MonthlyRecapDetail = MonthlyRecap;

export type MonthlyRecapResponse = {
  recap: MonthlyRecap;
};

export type LatestMonthlyRecapResponse = {
  recap?: MonthlyRecap;
};

export type SavedSignalSummary = MySignalSummary & {
  authorFreqCode?: string;
  frequencyProfile: SignalFrequencyProfile;
  savedAt: string;
  theme: string;
};

export type SavedSignalsResult = {
  signals: PublicSavedSignalSummary[];
};

export type SavedSignalsResponse = SavedSignalsResult;

export type ShareSignalCard = {
  expandedText: string;
  frequencyCode: string;
  imageUrl: string;
  signalId: string;
};

export type SignalEmbeddingMeta = {
  dimensions: number;
  model: string;
  provider: string;
  version: string;
};
