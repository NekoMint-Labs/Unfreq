import type { ChatProviderConfig, ChatProviderProfile } from "./provider-config.js";

const defaultAiProviderTimeoutMs = 20_000;
const fastAiProviderTimeoutMs = 10_000;
const aiProviderTimeoutMsByType: Partial<Record<string, number>> = {
  "signal-expansion": 20_000,
  "signal-material": 25_000,
};
const fastChatProviderTypes = new Set([
  "classify",
  "content-analysis",
  "moderate",
  "monthly-recap",
  "signal-expansion-review",
  "signal-intent-analysis",
  "signal-quality",
  "signal-seed-classification",
  "tags",
]);

function getConfigProfile(config: ChatProviderConfig): ChatProviderProfile {
  return config.profile ?? "default";
}

export function getChatProviderProfile(type: string): ChatProviderProfile {
  return fastChatProviderTypes.has(type) ? "fast" : "default";
}

export function getAiProviderTimeoutMs(type: string): number {
  if (aiProviderTimeoutMsByType[type] !== undefined) {
    return aiProviderTimeoutMsByType[type];
  }

  return getChatProviderProfile(type) === "fast"
    ? fastAiProviderTimeoutMs
    : defaultAiProviderTimeoutMs;
}

export function selectChatProviderConfigs(
  configs: ChatProviderConfig[],
  type: string,
): ChatProviderConfig[] {
  const profile = getChatProviderProfile(type);
  const profileConfigs = configs.filter((config) => getConfigProfile(config) === profile);

  if (profileConfigs.length > 0) {
    return profileConfigs;
  }

  return profile === "fast"
    ? configs.filter((config) => getConfigProfile(config) === "default")
    : configs.filter((config) => getConfigProfile(config) === "fast");
}
