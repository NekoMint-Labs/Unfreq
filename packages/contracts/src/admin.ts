import type {
  FrequencyIdentity,
  FrequencyRole,
  FrequencyStatus,
} from "./auth.js";
import type {
  SignalAudioStatus,
  SignalDetail,
  SignalDetailPage,
  SignalSource,
  SignalStatus,
} from "./signals.js";

export type AdminUserStatus = FrequencyStatus;
export type AdminSignalStatus = SignalStatus;
export type AdminSignalSource = SignalSource;
export type AdminReportStatus = "PENDING" | "REJECTED" | "RESOLVED";
export type AdminTargetType = "SIGNAL" | "USER";
export type AdminAiReviewStatus = "FALLBACK" | "SUCCEEDED";
export type AdminCapabilityStatus = "configured" | "degraded" | "disabled";
export type AdminChatProviderProfile = "default" | "fast";
export type AdminProviderConfigKind = "chat" | "embedding" | "reranker" | "tts";

export type AdminOverview = {
  aiReviews: {
    total: number;
  };
  aiOperations: {
    chatFallbacks: number;
    embeddingFailures: number;
    rerankerFailures: number;
    ttsFailures: number;
  };
  capabilities?: {
    chat: AdminCapabilityStatus;
    embedding: AdminCapabilityStatus;
    reranker: AdminCapabilityStatus;
    tts: AdminCapabilityStatus;
  };
  frequencies: {
    active: number;
    banned: number;
    muted: number;
  };
  galaxy: {
    missingCoordinates: number;
  };
  reports: {
    pending: number;
    rejected: number;
    resolved: number;
  };
  signals: {
    deleted: number;
    draft: number;
    hidden: number;
    published: number;
    reviewing: number;
    total: number;
  };
  users: {
    active: number;
    banned: number;
    muted: number;
  };
};

export type AdminProviderConfigRecord = {
  apiKeyLast4?: string;
  baseUrl: string;
  extraJson: Record<string, unknown>;
  id?: string;
  isEnabled: boolean;
  keyState: "configured" | "missing";
  kind: AdminProviderConfigKind;
  model: string;
  priority: number;
  provider: string;
  source: "database" | "environment";
  status: AdminCapabilityStatus;
  updatedAt?: string;
  updatedBy?: string;
};

export type AdminProviderConfigView = AdminProviderConfigRecord;

export type AdminProviderConfigTestResult = {
  checkedUrl?: string;
  detail: string;
  durationMs: number;
  kind: AdminProviderConfigKind;
  model: string;
  provider: string;
  reason:
    | "http_error"
    | "invalid_json"
    | "invalid_response"
    | "missing_config"
    | "network_error"
    | "not_supported"
    | "ok"
    | "timeout";
  status: "failed" | "passed" | "unsupported";
};

export type AdminSignalRecord = {
  audioStatus: SignalAudioStatus;
  createdAt: string;
  embedding: {
    dimensions?: number;
    model?: string;
    provider?: string;
    status: "missing" | "ready";
    version?: string;
  };
  expandedText: string;
  frequencyCode?: string;
  galaxyPositionStatus: "missing" | "ready";
  id: string;
  parentSignalId?: string;
  qualityReason?: string;
  qualityScore?: number;
  resonanceCount: number;
  seedText: string;
  source: SignalSource;
  status: AdminSignalStatus;
  updatedAt: string;
};

export type AdminSignalSummary = AdminSignalRecord;

export type AdminSignalPage = {
  hasNextPage: boolean;
  items: AdminSignalRecord[];
  limit: number;
  nextCursor?: string;
  total: number;
};

export type AdminReportRecord = {
  createdAt: string;
  id: string;
  note?: string;
  reason: string;
  reporterFreqCode: string;
  resolution?: string;
  resolvedAt?: string;
  status: AdminReportStatus;
  targetId: string;
  targetType: AdminTargetType;
};

export type AdminUserRecord = {
  createdAt: string;
  email: string | null;
  frequencyName: string | null;
  freqCode: string;
  id: string;
  isGuest: boolean;
  role: FrequencyRole;
  status: AdminUserStatus;
};

export type AdminFrequencyRecord = {
  code: string;
  createdAt: string;
  frequencyName?: string;
  id: string;
  isGuest: boolean;
  lastSeenAt?: string;
  role: FrequencyRole;
  status: AdminUserStatus;
};

export type AdminAiReviewRecord = {
  createdAt: string;
  id: string;
  inputText: string;
  model: string;
  outputJson: Record<string, unknown>;
  provider: string;
  reviewType: string;
  status: AdminAiReviewStatus;
  targetId?: string;
  targetType?: AdminTargetType;
};

export type AdminAiEvaluationMetric = {
  description: string;
  key: string;
  label: string;
  unit: "percent";
  value: number;
};

export type AdminAiEvaluationGroup = {
  label: string;
  method: "FINAL" | "RANDOM_BASELINE" | "RULE_BASELINE";
  metrics: AdminAiEvaluationMetric[];
};

export type AdminAiEvaluation = {
  ablations: Array<{
    label: string;
    matchTopKRelevance: number;
  }>;
  generatedAt: string;
  groups: AdminAiEvaluationGroup[];
  sampleSize: {
    classification: number;
    matching: number;
    moderation: number;
    tags: number;
  };
};

export type AdminAiEvaluationResult = AdminAiEvaluation;

export type AdminDashboardData = {
  aiReviews: AdminAiReviewRecord[];
  aiSignals: SignalDetailPage;
  evaluation: AdminAiEvaluation;
  frequencies: AdminFrequencyRecord[];
  overview: Required<AdminOverview>;
  providerConfigs: AdminProviderConfigRecord[];
  reports: AdminReportRecord[];
  signals: AdminSignalPage;
  users: AdminUserRecord[];
};

export type AdminSignalStatusUpdate = {
  status: SignalStatus;
};

export type AdminUserStatusUpdate = {
  status: AdminUserStatus;
};

export type AdminReportResolution = {
  resolution?: string;
  status: Exclude<AdminReportStatus, "PENDING">;
};

export type AdminGenerateSignalsResponse = {
  generation: {
    accepted: number;
    attempts: number;
    rejected: number;
    results: Array<{
      persona: {
        fmName: string;
        id: string;
      };
      quality: {
        reason: string;
        score: number;
      };
      signal: SignalDetail;
    }>;
  };
};

export type AdminKeepSignalUpdate = {
  isKept: boolean;
};

export type AdminProviderConfigUpdate = {
  apiKey?: string;
  baseUrl: string;
  clearApiKey?: boolean;
  extraJson?: Record<string, string | number | boolean | null>;
  isEnabled?: boolean;
  kind?: AdminProviderConfigKind;
  model: string;
  priority?: number;
  provider: string;
};

export type AdminProviderConfigBody = Omit<AdminProviderConfigUpdate, "extraJson"> & {
  extraJson?: Record<string, unknown>;
};

export type AdminProviderConfigTestResponse = {
  result: AdminProviderConfigTestResult;
};

export type AdminUserStatusQuery = {
  status?: AdminUserStatus;
};

export type AdminReportStatusQuery = {
  status?: AdminReportStatus;
};

export type AdminAiReviewQuery = {
  reviewType?: string;
  status?: AdminAiReviewStatus;
};

export type AdminSignalQuery = {
  cursor?: string;
  limit?: number;
  q?: string;
  source?: AdminSignalSource;
  status?: AdminSignalStatus;
};

export type AdminAiSignalQuery = {
  cursor?: string;
  limit?: number;
  q?: string;
  source?: AdminSignalSource;
};

export type AdminIdParams = {
  id: string;
};

export type AdminProviderConfigParams = {
  kind: AdminProviderConfigKind;
};

export type AdminProviderConfigIdParams = {
  id: string;
};

export type AdminSignalStatusBody = AdminSignalStatusUpdate;
export type AdminUserStatusBody = AdminUserStatusUpdate;
export type AdminReportResolutionBody = AdminReportResolution;

export type AdminGenerateSignalsBody = {
  count?: number;
};

export type AdminKeepSignalBody = AdminKeepSignalUpdate;
