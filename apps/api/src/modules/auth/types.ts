import type {
  FrequencyRole,
  FrequencyStatus,
  LoginResponse,
} from "@unfreq/contracts/auth";

export type {
  AuthenticatedFrequency,
  FrequencyIdentity,
  FrequencyNameSuggestionsResponse,
  FrequencyResponse,
  FrequencyRole,
  FrequencyStatus,
  LoginChallengeDeliveryMode,
  LoginChallengeIssueResult,
  LoginChallengeResponse,
  LoginResponse,
  MeResponse,
} from "@unfreq/contracts/auth";

export type AuthUserRecord = {
  createdAt: Date;
  email: string | null;
  frequencyName: string | null;
  freqCode: string;
  id: string;
  isGuest: boolean;
  passwordHash: string | null;
  role: FrequencyRole;
  status: FrequencyStatus;
  updatedAt: Date;
};

export type LoginResult = LoginResponse;
