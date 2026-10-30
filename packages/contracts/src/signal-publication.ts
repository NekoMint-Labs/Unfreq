import type {
  SignalDetail,
  SignalGalaxyPosition,
  SignalMatchSource,
  SignalPrimaryBand,
  SignalSource,
} from "./signals.js";

/** PostgreSQL integer range used by the persisted publication epoch. */
export const maxSignalPublicationVersion = 2_147_483_647;

/** Author-confirmed public content. Runtime validation limits tags to three preview-visible labels. */
export type SignalPublicContent = {
  expandedText: string;
  authorFreqCode?: string;
  tags: string[];
  /** Display classification only; its label must be among the confirmed tags. */
  primaryBand?: SignalPrimaryBand;
};

/** Confirmation content survives publication-version changes caused by withdrawal or moderation. */
export type SignalPublicationSnapshot = {
  kind: "AUTHOR_CONFIRMED";
  confirmedAt: string;
  content: SignalPublicContent;
  digest: string;
};

export type SignalPublicationPreview = {
  content: SignalPublicContent;
  digest: string;
  version: number;
};

export type SignalPublicationActions = {
  canPublish: boolean;
  canWithdraw: boolean;
  state:
    | "DRAFT"
    | "PUBLIC"
    | "WITHDRAWN"
    | "REVIEWING"
    | "HIDDEN"
    | "DELETED"
    | "GENERATING"
    | "FAILED"
    | "UNCONFIRMED";
  version: number;
  preview?: SignalPublicationPreview;
  publishedContent?: SignalPublicContent;
};

export type SignalMatchScoreProvenance = {
  version: "match-score-v1";
  scale: "zero_to_hundred";
  method: "rules" | "cosine" | "reranker";
  reason: "rules_only" | "reranker_complete" | "reranker_not_configured" | "reranker_failed";
};

export type PublicSignalMatchSummary = SignalPublicContent & {
  /** human means user-initiated; the confirmed body may include AI-assisted expansion. */
  contentSource?: SignalSource;
  scoreProvenance?: SignalMatchScoreProvenance;
  id: string;
  score: number;
  source: SignalMatchSource;
  resonanceCount: number;
  publicationVersion: number;
};

export type PublicSignalDetail = SignalPublicContent & {
  id: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  publicationVersion: number;
  status: "PUBLISHED";
  visibility: "PUBLIC";
  echoCount: number;
  resonanceCount: number;
  source: SignalSource;
  hasSaved?: boolean;
  matches: PublicSignalMatchSummary[];
};

export type PublicSavedSignalSummary = SignalPublicContent & {
  id: string;
  createdAt: string;
  savedAt: string;
  publicationVersion: number;
  status: "PUBLISHED";
  resonanceCount: number;
  source: SignalSource;
};

export type PublicGalaxySignalPoint = SignalPublicContent & {
  id: string;
  createdAt: string;
  publicationVersion: number;
  position: SignalGalaxyPosition;
  source: SignalSource;
  isMine: boolean;
  matchIds: string[];
  resonanceCount: number;
};

export type OwnerSignalDetail = Omit<SignalDetail, "matches"> & {
  visibility: "PRIVATE_OWNER";
  matches: PublicSignalMatchSummary[];
  publication: SignalPublicationActions;
};

export type WithdrawSignalRequest = {
  expectedVersion: number;
};

/** Confirms exactly the server-issued preview the author has just reviewed. */
export type PublishSignalRequest = {
  expectedVersion: number;
  digest: string;
};

export type WithdrawSignalResponse = {
  withdrawal: {
    id: string;
    withdrawn: true;
    publicationVersion: number;
  };
};
