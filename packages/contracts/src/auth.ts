export type FrequencyRole = "ADMIN" | "USER";

export type FrequencyStatus = "ACTIVE" | "BANNED" | "MUTED";

export type FrequencyIdentity = {
  code?: string;
  createdAt: string;
  frequencyName?: string;
  freqCode: string;
  id: string;
  isGuest?: boolean;
  lastSeenAt?: string;
  role: FrequencyRole;
  status: FrequencyStatus;
};

export type AuthenticatedFrequency = FrequencyIdentity;

export type LoginResponse = {
  frequency: FrequencyIdentity;
  isNewFrequency: boolean;
  sessionToken: string;
};

export type FrequencyResponse = {
  frequency: FrequencyIdentity;
};

export type LoginChallengeDeliveryMode = "local-log";

export type LoginChallengeResponse = {
  challenge: {
    expiresAt: string;
    retryAfterSeconds: number;
  };
  delivery: {
    code?: string;
    mode: LoginChallengeDeliveryMode;
  };
};

export type LoginChallengeIssueResult = LoginChallengeResponse & {
  localDelivery: {
    code: string;
    emailHash: string;
    maskedEmail: string;
  };
};

export type FrequencyNameSuggestionsResponse = {
  suggestions: string[];
};

export type MeResponse = {
  frequency: FrequencyIdentity;
};
