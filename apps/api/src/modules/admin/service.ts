import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import { listReports, resolveReport } from "../reports/service.js";
import type { EmbeddingLogger } from "../ai/embedding.js";
import {
  createProviderConfig,
  deleteProviderConfigById,
  findProviderConfigById,
  listProviderConfigViews,
  readEnvironmentApiKey,
  readProviderConfigApiKey,
  saveProviderConfig,
  updateProviderConfigById,
  type ProviderConfigRecord,
  type ProviderConfigKind,
} from "../ai/provider-config.js";
import { testProviderConfig } from "../ai/provider-health.js";
import type {
  AdminAiReviewQuery,
  AdminProviderConfigBody,
  AdminReportStatus,
  AdminSignalStatus,
  AdminSignalSource,
  AdminUserStatus,
} from "./schemas.js";
import type {
  AdminAiReviewRecord,
  AdminAiEvaluationResult,
  AdminCapabilityStatus,
  AdminFrequencyRecord,
  AdminProviderConfigView,
  AdminReportRecord,
  AdminSignalRecord,
  AdminUserRecord,
} from "./types.js";
import { calculateAiEvaluation } from "./ai-evaluation.js";
import {
  deleteAdminSignal,
  generateAiSignals,
  getAdminSignals,
  getAdminSignalSummaries,
  keepAdminSignal,
  updateAdminSignalStatus,
} from "../signals/service.js";
import type {
  AiSignalGenerationSummary,
  SignalDetail,
} from "../signals/types.js";
import {
  getAdminOverview,
  listAdminAiReviewRecords,
  listAdminFrequencyRecords,
  listAdminUserRecords,
  recordAdminAction,
  updateAdminFrequencyStatus,
  updateAdminUserStatus,
} from "./repository.js";

export function requireAdmin(frequency: AuthenticatedFrequency): AuthenticatedFrequency {
  if (frequency.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Admin access required.");
  }

  return frequency;
}

function toDeletedAdminProviderConfigView(
  config: ProviderConfigRecord,
): AdminProviderConfigView {
  return {
    apiKeyLast4: config.apiKeyLast4,
    baseUrl: config.baseUrl,
    extraJson: config.extraJson ?? {},
    id: config.id,
    isEnabled: config.isEnabled,
    keyState: config.apiKeyLast4 === undefined ? "missing" : "configured",
    kind: config.kind,
    model: config.model,
    priority: config.priority,
    provider: config.provider,
    source: "database",
    status: config.isEnabled ? "configured" : "disabled",
    updatedAt: config.updatedAt?.toISOString(),
    updatedBy: config.updatedBy,
  };
}

function summarizeProviderCapabilityStatus(
  providerConfigs: AdminProviderConfigView[],
  kind: ProviderConfigKind,
): AdminCapabilityStatus {
  const configs = providerConfigs.filter((config) => config.kind === kind);

  if (configs.some((config) => config.status === "configured")) {
    return "configured";
  }

  if (configs.some((config) => config.status === "degraded")) {
    return "degraded";
  }

  return "disabled";
}

export async function readAdminOverview(frequency: AuthenticatedFrequency) {
  requireAdmin(frequency);
  const overview = await getAdminOverview();
  const providerConfigs = await listProviderConfigViews({
    failures: {
      chat: overview.aiOperations.chatFallbacks,
      embedding: overview.aiOperations.embeddingFailures,
      reranker: overview.aiOperations.rerankerFailures,
      tts: overview.aiOperations.ttsFailures,
    },
  });

  return {
    ...overview,
    capabilities: {
      chat: summarizeProviderCapabilityStatus(providerConfigs, "chat"),
      embedding: summarizeProviderCapabilityStatus(providerConfigs, "embedding"),
      reranker: summarizeProviderCapabilityStatus(providerConfigs, "reranker"),
      tts: summarizeProviderCapabilityStatus(providerConfigs, "tts"),
    },
  };
}

export async function readAdminProviderConfigs(
  frequency: AuthenticatedFrequency,
): Promise<AdminProviderConfigView[]> {
  requireAdmin(frequency);
  const overview = await getAdminOverview();

  return listProviderConfigViews({
    failures: {
      chat: overview.aiOperations.chatFallbacks,
      embedding: overview.aiOperations.embeddingFailures,
      reranker: overview.aiOperations.rerankerFailures,
      tts: overview.aiOperations.ttsFailures,
    },
  });
}

export async function testAdminProviderConfig(params: {
  body: AdminProviderConfigBody;
  environment?: boolean;
  frequency: AuthenticatedFrequency;
  id?: string;
  kind: ProviderConfigKind;
}) {
  requireAdmin(params.frequency);
  const storedConfig =
    params.id === undefined ? undefined : await findProviderConfigById(params.id);

  if (
    params.id !== undefined &&
    (storedConfig === undefined || storedConfig.kind !== params.kind)
  ) {
    throw new AppError("NOT_FOUND", "Provider config not found.");
  }

  const environmentApiKey = readEnvironmentApiKey(params.kind);
  const fallbackApiKey =
    params.body.clearApiKey === true || storedConfig === undefined
      ? environmentApiKey
      : readProviderConfigApiKey(storedConfig, environmentApiKey);

  const result = await testProviderConfig(params.kind, {
    ...params.body,
    apiKey:
      params.body.apiKey !== undefined && params.body.apiKey.length > 0
        ? params.body.apiKey
        : fallbackApiKey,
    kind: params.kind,
  });

  await recordAdminAction({
    action: "provider_config.test",
    adminId: params.frequency.id,
    details: {
      kind: params.kind,
      model: params.body.model,
      provider: params.body.provider,
      reason: result.reason,
      status: result.status,
    },
    targetId: params.frequency.id,
    targetType: "USER",
  });

  return result;
}

export async function changeAdminProviderConfig(params: {
  body: AdminProviderConfigBody;
  frequency: AuthenticatedFrequency;
  kind: ProviderConfigKind;
}): Promise<AdminProviderConfigView> {
  requireAdmin(params.frequency);

  await saveProviderConfig({
    config: {
      apiKey: params.body.apiKey,
      baseUrl: params.body.baseUrl,
      clearApiKey: params.body.clearApiKey,
      extraJson: params.body.extraJson,
      isEnabled: params.body.isEnabled,
      kind: params.kind,
      model: params.body.model,
      priority: params.body.priority,
      provider: params.body.provider,
    },
    updatedBy: params.frequency.id,
  });

  await recordAdminAction({
    action: "provider_config.update",
    adminId: params.frequency.id,
    details: {
      baseUrl: params.body.baseUrl.length > 0 ? "configured" : "empty",
      hasNewApiKey: params.body.apiKey !== undefined && params.body.apiKey.length > 0,
      kind: params.kind,
      model: params.body.model,
      provider: params.body.provider,
    },
    targetId: params.frequency.id,
    targetType: "USER",
  });

  const configs = await readAdminProviderConfigs(params.frequency);
  const config = configs.find((item) => item.kind === params.kind);

  if (config === undefined) {
    throw new AppError("INTERNAL_ERROR", "Provider config was not found after update.");
  }

  return config;
}

export async function createAdminProviderConfig(params: {
  body: AdminProviderConfigBody;
  frequency: AuthenticatedFrequency;
  kind: ProviderConfigKind;
}): Promise<AdminProviderConfigView> {
  requireAdmin(params.frequency);

  const created = await createProviderConfig({
    config: {
      apiKey: params.body.apiKey,
      baseUrl: params.body.baseUrl,
      clearApiKey: params.body.clearApiKey,
      extraJson: params.body.extraJson,
      isEnabled: params.body.isEnabled,
      kind: params.kind,
      model: params.body.model,
      priority: params.body.priority,
      provider: params.body.provider,
    },
    updatedBy: params.frequency.id,
  });

  await recordAdminAction({
    action: "provider_config.create",
    adminId: params.frequency.id,
    details: {
      hasNewApiKey: params.body.apiKey !== undefined && params.body.apiKey.length > 0,
      kind: params.kind,
      model: params.body.model,
      priority: params.body.priority ?? created.priority,
      provider: params.body.provider,
    },
    targetId: created.id ?? params.frequency.id,
    targetType: "USER",
  });

  const configs = await readAdminProviderConfigs(params.frequency);
  const config = configs.find((item) => item.id === created.id);

  if (config === undefined) {
    throw new AppError("INTERNAL_ERROR", "Provider config was not found after create.");
  }

  return config;
}

export async function updateAdminProviderConfigById(params: {
  body: AdminProviderConfigBody;
  frequency: AuthenticatedFrequency;
  id: string;
  kind: ProviderConfigKind;
}): Promise<AdminProviderConfigView> {
  requireAdmin(params.frequency);

  const updated = await updateProviderConfigById({
    config: {
      apiKey: params.body.apiKey,
      baseUrl: params.body.baseUrl,
      clearApiKey: params.body.clearApiKey,
      extraJson: params.body.extraJson,
      isEnabled: params.body.isEnabled,
      kind: params.kind,
      model: params.body.model,
      priority: params.body.priority,
      provider: params.body.provider,
    },
    id: params.id,
    kind: params.kind,
    updatedBy: params.frequency.id,
  });

  await recordAdminAction({
    action: "provider_config.update",
    adminId: params.frequency.id,
    details: {
      hasNewApiKey: params.body.apiKey !== undefined && params.body.apiKey.length > 0,
      kind: params.kind,
      model: params.body.model,
      priority: params.body.priority ?? updated.priority,
      provider: params.body.provider,
    },
    targetId: params.id,
    targetType: "USER",
  });

  const configs = await readAdminProviderConfigs(params.frequency);
  const config = configs.find((item) => item.id === params.id);

  if (config === undefined) {
    throw new AppError("INTERNAL_ERROR", "Provider config was not found after update.");
  }

  return config;
}

export async function deleteAdminProviderConfig(params: {
  frequency: AuthenticatedFrequency;
  id: string;
  kind?: ProviderConfigKind;
}): Promise<AdminProviderConfigView> {
  requireAdmin(params.frequency);
  const deleted = await deleteProviderConfigById({
    id: params.id,
    kind: params.kind,
  });

  await recordAdminAction({
    action: "provider_config.delete",
    adminId: params.frequency.id,
    details: {
      kind: deleted.kind,
      model: deleted.model,
      provider: deleted.provider,
    },
    targetId: params.id,
    targetType: "USER",
  });

  return toDeletedAdminProviderConfigView(deleted);
}

export async function readAdminReports(
  frequency: AuthenticatedFrequency,
  status?: AdminReportStatus,
): Promise<AdminReportRecord[]> {
  requireAdmin(frequency);
  return listReports(status);
}

export async function readAdminAiReviews(
  frequency: AuthenticatedFrequency,
  query: AdminAiReviewQuery,
): Promise<AdminAiReviewRecord[]> {
  requireAdmin(frequency);
  return listAdminAiReviewRecords(query);
}

export async function readAdminAiEvaluation(
  frequency: AuthenticatedFrequency,
): Promise<AdminAiEvaluationResult> {
  requireAdmin(frequency);
  return calculateAiEvaluation();
}

export async function readAdminSignals(
  frequency: AuthenticatedFrequency,
  query: {
    cursor?: string;
    limit?: number;
    q?: string;
    source?: AdminSignalSource;
    status?: AdminSignalStatus;
  } = {},
): Promise<{
  hasNextPage: boolean;
  items: AdminSignalRecord[];
  limit: number;
  nextCursor?: string;
  total: number;
}> {
  requireAdmin(frequency);
  return getAdminSignalSummaries(query);
}

export async function readAdminAiSignals(
  frequency: AuthenticatedFrequency,
  query: {
    cursor?: string;
    limit?: number;
    q?: string;
    source?: AdminSignalSource;
  } = {},
): Promise<{
  hasNextPage: boolean;
  items: SignalDetail[];
  limit: number;
  nextCursor?: string;
  total: number;
}> {
  requireAdmin(frequency);
  return getAdminSignals(query);
}

export async function changeAdminSignalStatus(params: {
  frequency: AuthenticatedFrequency;
  id: string;
  status: AdminSignalStatus;
}): Promise<AdminSignalRecord> {
  requireAdmin(params.frequency);

  const signal = await updateAdminSignalStatus({
    id: params.id,
    status: params.status,
  });

  await recordAdminAction({
    action: "signal.status.update",
    adminId: params.frequency.id,
    details: { status: params.status },
    targetId: params.id,
    targetType: "SIGNAL",
  });

  return signal;
}

export async function createAdminAiSignals(params: {
  count?: number;
  frequency: AuthenticatedFrequency;
  logger?: EmbeddingLogger;
}): Promise<AiSignalGenerationSummary> {
  requireAdmin(params.frequency);
  return generateAiSignals({
    count: params.count,
    logger: params.logger,
  });
}

export async function removeAdminSignal(params: {
  frequency: AuthenticatedFrequency;
  id: string;
}): Promise<SignalDetail> {
  requireAdmin(params.frequency);

  const signal = await deleteAdminSignal(params.id);

  await recordAdminAction({
    action: "signal.delete",
    adminId: params.frequency.id,
    details: { source: signal.source },
    targetId: params.id,
    targetType: "SIGNAL",
  });

  return signal;
}

export async function changeAdminSignalKept(params: {
  frequency: AuthenticatedFrequency;
  id: string;
  isKept: boolean;
}): Promise<SignalDetail> {
  requireAdmin(params.frequency);

  const signal = await keepAdminSignal({
    id: params.id,
    isKept: params.isKept,
  });

  await recordAdminAction({
    action: "signal.keep.update",
    adminId: params.frequency.id,
    details: { isKept: params.isKept, source: signal.source },
    targetId: params.id,
    targetType: "SIGNAL",
  });

  return signal;
}

export async function changeAdminReportStatus(params: {
  frequency: AuthenticatedFrequency;
  id: string;
  resolution?: string;
  status: Exclude<AdminReportStatus, "PENDING">;
}): Promise<AdminReportRecord> {
  requireAdmin(params.frequency);

  const report = await resolveReport({
    adminId: params.frequency.id,
    id: params.id,
    resolution: params.resolution,
    status: params.status,
  });

  await recordAdminAction({
    action: "report.status.update",
    adminId: params.frequency.id,
    details: {
      reportId: report.id,
      resolution: params.resolution ?? null,
      status: params.status,
    },
    targetId: report.targetId,
    targetType: report.targetType,
  });

  return report;
}

export async function readAdminUsers(
  frequency: AuthenticatedFrequency,
  status?: AdminUserStatus,
): Promise<AdminUserRecord[]> {
  requireAdmin(frequency);
  return listAdminUserRecords(status);
}

export async function readAdminFrequencies(
  frequency: AuthenticatedFrequency,
  status?: AdminUserStatus,
): Promise<AdminFrequencyRecord[]> {
  requireAdmin(frequency);
  return listAdminFrequencyRecords(status);
}

export async function changeAdminFrequencyStatus(params: {
  frequency: AuthenticatedFrequency;
  id: string;
  status: AdminUserStatus;
}): Promise<AdminFrequencyRecord> {
  requireAdmin(params.frequency);

  const targetFrequency = await updateAdminFrequencyStatus({
    id: params.id,
    status: params.status,
  });

  if (targetFrequency === undefined) {
    throw new AppError("NOT_FOUND", "Frequency not found.");
  }

  await recordAdminAction({
    action: "frequency.status.update",
    adminId: params.frequency.id,
    details: { status: params.status },
    targetId: params.id,
    targetType: "USER",
  });

  return targetFrequency;
}

export async function changeAdminUserStatus(params: {
  frequency: AuthenticatedFrequency;
  id: string;
  status: AdminUserStatus;
}): Promise<AdminUserRecord> {
  requireAdmin(params.frequency);

  const user = await updateAdminUserStatus({
    id: params.id,
    status: params.status,
  });

  if (user === undefined) {
    throw new AppError("NOT_FOUND", "Frequency not found.");
  }

  await recordAdminAction({
    action: "user.status.update",
    adminId: params.frequency.id,
    details: { status: params.status },
    targetId: params.id,
    targetType: "USER",
  });

  return user;
}
