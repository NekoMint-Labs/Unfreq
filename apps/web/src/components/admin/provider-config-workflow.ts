import type {
  AdminChatProviderProfile,
  AdminProviderConfigKind,
  AdminProviderConfigRecord,
  AdminProviderConfigUpdate,
} from "@unfreq/contracts/admin";

export type ProviderConfigDraft = {
  apiKey: string;
  baseUrl: string;
  chatProfile: AdminChatProviderProfile;
  clearApiKey: boolean;
  dimensions: string;
  isEnabled: boolean;
  model: string;
  priority: string;
  provider: string;
  version: string;
  voiceLeft: string;
  voiceRight: string;
};

type ProviderDeleteTarget = {
  kindLabel: string;
  model: string;
  provider: string;
};

type ConfirmedDeleteAction = {
  confirmDelete: (message: string) => boolean;
  deleteProviderConfig: () => Promise<void>;
  target: ProviderDeleteTarget;
};

const providerConfigDraftPriority = 100;

export function removeProviderDraftOverride<T>(
  providerDrafts: Record<string, T>,
  draftKey: string,
): Record<string, T> {
  const remainingDrafts = { ...providerDrafts };
  delete remainingDrafts[draftKey];

  return remainingDrafts;
}

export function getProviderDeleteConfirmationMessage(target: ProviderDeleteTarget): string {
  return `确认删除 ${target.kindLabel} 配置 ${target.provider} / ${target.model}？`;
}

export async function confirmAndDeleteProviderConfig({
  confirmDelete,
  deleteProviderConfig,
  target,
}: ConfirmedDeleteAction): Promise<boolean> {
  if (!confirmDelete(getProviderDeleteConfirmationMessage(target))) {
    return false;
  }

  await deleteProviderConfig();
  return true;
}

export function readProviderExtraString(
  extraJson: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const value = extraJson[key];

  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

export function readChatProviderProfile(
  extraJson: Record<string, unknown>,
): AdminChatProviderProfile {
  return extraJson.chatProfile === "fast" ? "fast" : "default";
}

export function getProviderDraftKey(config: AdminProviderConfigRecord): string {
  return config.id ?? `environment:${config.kind}`;
}

export function createEmptyProviderDraft(kind: AdminProviderConfigKind): ProviderConfigDraft {
  return {
    apiKey: "",
    baseUrl: "",
    chatProfile: "default",
    clearApiKey: false,
    dimensions: kind === "embedding" ? "1024" : "",
    isEnabled: true,
    model: "",
    priority: String(providerConfigDraftPriority),
    provider: kind === "reranker" ? "disabled" : "",
    version: kind === "embedding" ? "v1" : "",
    voiceLeft: kind === "tts" ? "longxiaochun" : "",
    voiceRight: kind === "tts" ? "longcheng" : "",
  };
}

export function toProviderDrafts(
  providerConfigs: AdminProviderConfigRecord[],
): Record<string, ProviderConfigDraft> {
  return providerConfigs.reduce(
    (drafts, config) => {
      const draftKey = getProviderDraftKey(config);
      drafts[draftKey] = {
        apiKey: "",
        baseUrl: config.baseUrl,
        chatProfile: readChatProviderProfile(config.extraJson),
        clearApiKey: false,
        dimensions: readProviderExtraString(config.extraJson, "dimensions"),
        isEnabled: config.isEnabled,
        model: config.model,
        priority:
          config.source === "environment"
            ? String(providerConfigDraftPriority)
            : String(config.priority),
        provider: config.provider,
        version: readProviderExtraString(config.extraJson, "version"),
        voiceLeft: readProviderExtraString(config.extraJson, "voiceLeft"),
        voiceRight: readProviderExtraString(config.extraJson, "voiceRight"),
      };

      return drafts;
    },
    {} as Record<string, ProviderConfigDraft>,
  );
}

export function buildProviderPayload(
  kind: AdminProviderConfigKind,
  draft: ProviderConfigDraft,
): AdminProviderConfigUpdate {
  const extraJson: Record<string, string | number | boolean | null> = {};
  const priority = Number(draft.priority);

  if (kind === "embedding") {
    const dimensions = Number(draft.dimensions);

    if (Number.isInteger(dimensions) && dimensions > 0) {
      extraJson.dimensions = dimensions;
    }

    if (draft.version.trim().length > 0) {
      extraJson.version = draft.version.trim();
    }
  }

  if (kind === "chat") {
    extraJson.chatProfile = draft.chatProfile;
  }

  if (kind === "tts") {
    if (draft.voiceLeft.trim().length > 0) {
      extraJson.voiceLeft = draft.voiceLeft.trim();
    }

    if (draft.voiceRight.trim().length > 0) {
      extraJson.voiceRight = draft.voiceRight.trim();
    }
  }

  return {
    ...(draft.apiKey.trim().length > 0 ? { apiKey: draft.apiKey.trim() } : {}),
    baseUrl: draft.baseUrl.trim(),
    ...(draft.clearApiKey ? { clearApiKey: true } : {}),
    extraJson,
    isEnabled: draft.isEnabled,
    kind,
    model: draft.model.trim(),
    ...(Number.isInteger(priority) && priority > 0 ? { priority } : {}),
    provider: draft.provider.trim(),
  };
}
