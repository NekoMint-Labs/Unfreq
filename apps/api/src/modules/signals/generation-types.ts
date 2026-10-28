import type { AuthenticatedFrequency } from "../auth/types.js";
import type { CreatePublishedSignalBody } from "./schemas.js";
import type { CreateSignalInput, SignalGalaxyPosition, WriteSignalEmbeddingInput } from "./types.js";

export type RunningGenerationPhase = "EXPANDING" | "MATCHING" | "WRITING";

export type GenerationFence = Readonly<{
  signalId: string;
  attemptId: string;
  ownerId: string;
}>;

export type GenerationCasResult<T = undefined> =
  | { outcome: "APPLIED"; value: T }
  | { outcome: "OBSOLETE" };

export type GenerationClaim = GenerationFence & Readonly<{
  attemptCount: number;
  leaseUntil: Date;
  deadlineAt: Date;
  remainingMs: number;
}>;

export type OwnedGenerationInput = Readonly<{
  signalId: string;
  body: CreatePublishedSignalBody;
  frequency: AuthenticatedFrequency;
}>;

// Deliberately excludes identity, source, Seed and parent fields from completion.
export type GenerationOutput = Pick<CreateSignalInput,
  "expandedText" | "fingerprint" | "followUpQuestion" | "frequencyProfile" |
  "matchSignalId" | "program" | "qualityReason" | "qualityScore"
> & {
  expandedText: string;
  galaxyPosition: SignalGalaxyPosition;
  embedding?: Omit<WriteSignalEmbeddingInput, "id">;
  status: "DRAFT" | "REVIEWING";
};

export type GenerationFailureCode =
  | "GENERATION_FAILED"
  | "GENERATION_RETRY_EXHAUSTED"
  | "GENERATION_TIMEOUT"
  | "GENERATION_OUTCOME_UNKNOWN"
  | "GENERATION_RATE_LIMITED"
  | "GENERATION_PROTECTION_UNAVAILABLE"
  | "GENERATION_SUPERSEDED";

export type GenerationRepositoryOptions = Readonly<{
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  maxConnections?: number;
}>;
