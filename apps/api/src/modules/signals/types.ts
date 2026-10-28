import type {
  SignalAudioStatus,
  SignalDetail,
  SignalEmbeddingMeta,
  SignalFingerprint,
  SignalFrequencyProfile,
  SignalGalaxyPosition,
  SignalGenerationStatus,
  SignalPrimaryBand,
  SignalProgram,
  SignalSource,
  SignalStatus,
  SignalSubFeeling,
} from "@unfreq/contracts/signals";
export type {
  AdminSignalSummary,
} from "@unfreq/contracts/admin";
export type {
  GalaxyResult,
  GalaxySignalPoint,
  SignalAudioDetail,
  SignalAudioStatus,
  SignalDetail,
  SignalEchoDetail,
  SignalEmbeddingMeta,
  SignalFingerprint,
  SignalFrequencyProfile,
  SignalGalaxyPosition,
  SignalGenerationDetail,
  SignalGenerationStatus,
  SignalMatchSource,
  SignalMatchSummary,
  SignalPrimaryBand,
  SignalProgram,
  SignalPreviewDetail,
  ReviewingSignalRestrictedDetail,
  SignalResultDetail,
  SignalResonanceResult,
  SignalRiskLevel,
  SignalSaveResult,
  SignalSource,
  SignalStatus,
  SignalSubFeeling,
  MySignalSummary,
  MySignalsResult,
  EchoSummary,
  SavedSignalSummary,
  SavedSignalsResult,
} from "@unfreq/contracts/signals";

export type SignalRecord = {
  authorFreqCode: string | null;
  authorId: string | null;
  audioError: string | null;
  audioStatus: SignalAudioStatus;
  audioStorageKey: string | null;
  audioStorageKeyLeft: string | null;
  audioStorageKeyRight: string | null;
  audioUrl: string | null;
  audioUrlLeft: string | null;
  audioUrlRight: string | null;
  createdAt: Date;
  echoCount: number;
  embedding: number[] | null;
  embeddingDimensions: number | null;
  embeddingModel: string | null;
  embeddingProvider: string | null;
  embeddingVersion: string | null;
  expandedText: string;
  fingerprintJson: SignalFingerprint;
  followUpQuestion: string | null;
  frequencyId: string | null;
  galaxyPosition: SignalGalaxyPosition | null;
  generationError: string | null;
  generationStatus: SignalGenerationStatus;
  guestKey: string | null;
  id: string;
  coreNeed: string | null;
  emotionTone: string | null;
  innerConflict: string | null;
  matchSignalId: string | null;
  parentSignalId: string | null;
  primaryBand: SignalPrimaryBand | null;
  programJson: SignalProgram;
  qualityReason: string | null;
  qualityScore: number | null;
  rawInput: string;
  resonanceCount: number;
  resonanceKeywords: string[] | null;
  seedText: string;
  source: SignalSource;
  status: SignalStatus;
  subFeeling: SignalSubFeeling | null;
  isKept: boolean;
  updatedAt: Date;
};

export type SavedSignalRecord = SignalRecord & {
  savedAt: Date;
};

export type SignalSemanticMatchRecord = SignalRecord & {
  distance: number;
};

export type SignalEchoRecord = {
  authorFreqCode: string | null;
  authorId: string | null;
  content: string;
  createdAt: Date;
  guestKey: string | null;
  id: string;
  signalId: string;
  status: "DELETED" | "HIDDEN" | "PUBLISHED" | "REVIEWING";
  updatedAt: Date;
};

export type AdminSignalListQuery = {
  cursor?: string;
  limit?: number;
  q?: string;
  source?: SignalSource;
  status?: SignalStatus;
};

export type AdminSignalListPage = {
  hasNextPage: boolean;
  items: SignalRecord[];
  nextCursor?: string;
  total: number;
};

export type CreateSignalInput = {
  authorId?: string;
  expandedText?: string;
  fingerprint: SignalFingerprint;
  followUpQuestion?: string;
  frequencyProfile?: SignalFrequencyProfile;
  frequencyId?: string;
  galaxyPosition?: SignalGalaxyPosition;
  generationError?: string | null;
  generationStatus?: SignalGenerationStatus;
  guestKey?: string;
  matchSignalId?: string;
  parentSignalId?: string;
  program: SignalProgram;
  qualityReason?: string;
  qualityScore?: number;
  rawInput: string;
  seedText?: string;
  source?: SignalSource;
  status?: SignalStatus;
};

export type WriteSignalEmbeddingInput = SignalEmbeddingMeta & {
  embedding: number[];
  id: string;
};

export type SignalContentQuality = {
  reason: string;
  score: number;
};

export type SignalPersona = {
  age: number;
  commonScenes: string[];
  currentConcern: string;
  fmName: string;
  id: string;
  occupation: string;
  style: string;
};

export type AiSignalContent = {
  rawInput: string;
};

export type AiGeneratedSignalResult = {
  persona: SignalPersona;
  quality: SignalContentQuality;
  signal: SignalDetail;
};

export type AiSignalGenerationSummary = {
  accepted: number;
  attempts: number;
  rejected: number;
  results: AiGeneratedSignalResult[];
};

export type SignalInteractionSummary = {
  echoCount: number;
  resonanceCount: number;
  signalId: string;
};
