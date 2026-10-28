import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { providerConfigs } from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";

export type ProviderConfigKind = "chat" | "embedding" | "reranker" | "tts";

export type ProviderConfigKeyState = "configured" | "missing";

export type ProviderConfigRecord = {
  apiKeyCiphertext?: string;
  apiKeyLast4?: string;
  baseUrl: string;
  extraJson?: Record<string, unknown>;
  id?: string;
  isEnabled: boolean;
  kind: ProviderConfigKind;
  model: string;
  priority: number;
  provider: string;
  updatedAt?: Date;
  updatedBy?: string;
};

export type ProviderConfigView = {
  apiKeyLast4?: string;
  baseUrl: string;
  extraJson: Record<string, unknown>;
  id?: string;
  isEnabled: boolean;
  keyState: ProviderConfigKeyState;
  kind: ProviderConfigKind;
  model: string;
  priority: number;
  provider: string;
  source: "database" | "environment";
  status: "configured" | "degraded" | "disabled";
  updatedAt?: string;
  updatedBy?: string;
};

export type ProviderConfigUpdate = {
  apiKey?: string;
  baseUrl: string;
  clearApiKey?: boolean;
  extraJson?: Record<string, unknown>;
  isEnabled?: boolean;
  kind: ProviderConfigKind;
  model: string;
  priority?: number;
  provider: string;
};

export type ChatProviderConfig = {
  apiKey: string;
  baseUrl: string;
  profile: ChatProviderProfile;
  model: string;
  provider: string;
};

export type ChatProviderProfile = "default" | "fast";

export type EmbeddingProviderConfig = {
  apiKey: string;
  baseUrl: string;
  dimensions: number;
  model: string;
  provider: string;
  version: string;
};

export type TtsProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  voiceLeft: string;
  voiceRight: string;
};

export type RerankerProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
};

const encryptedValuePrefix = "v1";

const defaultDashScopeEmbeddingBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const defaultDashScopeTtsBaseUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const chatProviderProfiles = ["default", "fast"] as const;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function compactText(value: string): string {
  return value.trim();
}

function readStringExtra(
  extraJson: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = extraJson?.[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumberExtra(
  extraJson: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = extraJson?.[key];

  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readChatProviderProfile(
  extraJson: Record<string, unknown> | undefined,
): ChatProviderProfile {
  const value = extraJson?.chatProfile;

  return typeof value === "string" && chatProviderProfiles.includes(value as ChatProviderProfile)
    ? value as ChatProviderProfile
    : "default";
}

function getChatEnvironmentApiKey(profile: ChatProviderProfile): string {
  return profile === "fast" && env.aiFastApiKey.length > 0 ? env.aiFastApiKey : env.aiApiKey;
}

function getDefaultPriority(kind: ProviderConfigKind): number {
  const priorities: Record<ProviderConfigKind, number> = {
    chat: 100,
    embedding: 100,
    reranker: 100,
    tts: 100,
  };

  return priorities[kind];
}

function getEncryptionKey(): Buffer {
  if (env.providerConfigSecret.length === 0) {
    throw new AppError("VALIDATION_ERROR", "PROVIDER_CONFIG_SECRET is required to store API keys.");
  }

  return createHash("sha256").update(env.providerConfigSecret).digest();
}

function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    encryptedValuePrefix,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptApiKey(ciphertext: string): string {
  const [version, iv, authTag, encrypted] = ciphertext.split(":");

  if (
    version !== encryptedValuePrefix ||
    iv === undefined ||
    authTag === undefined ||
    encrypted === undefined
  ) {
    throw new AppError("AI_UNAVAILABLE", "Stored provider key is invalid.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError("AI_UNAVAILABLE", "Stored provider key is invalid.");
  }
}

export function readProviderConfigApiKey(
  config: ProviderConfigRecord,
  environmentApiKey: string,
): string | undefined {
  if (config.apiKeyCiphertext === undefined) {
    return environmentApiKey;
  }

  try {
    return decryptApiKey(config.apiKeyCiphertext);
  } catch {
    return undefined;
  }
}

function hasProviderConfigApiKey(
  config: ProviderConfigRecord,
  environmentApiKey: string,
): boolean {
  if (config.apiKeyCiphertext === undefined) {
    return environmentApiKey.length > 0;
  }

  return readProviderConfigApiKey(config, environmentApiKey) !== undefined;
}

function toApiKeyLast4(apiKey: string): string {
  return apiKey.slice(-4);
}

function toRecord(row: typeof providerConfigs.$inferSelect): ProviderConfigRecord {
  return {
    apiKeyCiphertext: row.apiKeyCiphertext ?? undefined,
    apiKeyLast4: row.apiKeyLast4 ?? undefined,
    baseUrl: row.baseUrl,
    extraJson: row.extraJson ?? undefined,
    id: row.id,
    isEnabled: row.isEnabled ?? true,
    kind: row.kind,
    model: row.model,
    priority: row.priority ?? getDefaultPriority(row.kind),
    provider: row.provider,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export function getEnvironmentProviderConfig(kind: ProviderConfigKind): ProviderConfigRecord {
  if (kind === "chat") {
    return {
      apiKeyLast4: env.aiApiKey.length > 0 ? toApiKeyLast4(env.aiApiKey) : undefined,
      baseUrl: env.aiBaseUrl,
      isEnabled: true,
      kind,
      model: env.aiModel,
      priority: 1000,
      provider: env.aiProvider,
    };
  }

  if (kind === "embedding") {
    return {
      apiKeyLast4:
        env.embeddingApiKey.length > 0 ? toApiKeyLast4(env.embeddingApiKey) : undefined,
      baseUrl:
        env.embeddingBaseUrl.length > 0
          ? env.embeddingBaseUrl
          : defaultDashScopeEmbeddingBaseUrl,
      extraJson: {
        dimensions: env.embeddingDimensions,
        version: env.embeddingVersion,
      },
      isEnabled: true,
      kind,
      model: env.embeddingModel,
      priority: 1000,
      provider: env.embeddingProvider,
    };
  }

  if (kind === "tts") {
    return {
      apiKeyLast4: env.ttsApiKey.length > 0 ? toApiKeyLast4(env.ttsApiKey) : undefined,
      baseUrl: env.ttsBaseUrl.length > 0 ? env.ttsBaseUrl : defaultDashScopeTtsBaseUrl,
      extraJson: {
        voiceLeft: env.ttsVoiceLeft,
        voiceRight: env.ttsVoiceRight,
      },
      isEnabled: true,
      kind,
      model: env.ttsModel,
      priority: 1000,
      provider: env.ttsProvider,
    };
  }

  return {
    apiKeyLast4:
      env.rerankerApiKey.length > 0 ? toApiKeyLast4(env.rerankerApiKey) : undefined,
    baseUrl: env.rerankerBaseUrl,
    isEnabled: true,
    kind,
    model: env.rerankerModel,
    priority: 1000,
    provider: env.rerankerProvider,
  };
}

export function readEnvironmentApiKey(kind: ProviderConfigKind): string {
  if (kind === "chat") {
    return env.aiApiKey;
  }

  if (kind === "embedding") {
    return env.embeddingApiKey;
  }

  if (kind === "tts") {
    return env.ttsApiKey;
  }

  return env.rerankerApiKey;
}

export async function findProviderConfig(
  kind: ProviderConfigKind,
): Promise<ProviderConfigRecord | undefined> {
  const configs = await listProviderConfigsByKind(kind);
  return configs[0];
}

export async function listProviderConfigsByKind(
  kind: ProviderConfigKind,
): Promise<ProviderConfigRecord[]> {
  let rows: Array<typeof providerConfigs.$inferSelect>;

  try {
    rows = await db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.kind, kind))
      .orderBy(asc(providerConfigs.priority), asc(providerConfigs.createdAt));
  } catch {
    return [];
  }

  return rows.map(toRecord);
}

export async function listProviderConfigViews(params: {
  failures: {
    chat: number;
    embedding: number;
    reranker: number;
    tts: number;
  };
}): Promise<ProviderConfigView[]> {
  const rows = await db.select().from(providerConfigs);
  const records = rows
    .map(toRecord)
    .sort((left, right) => left.priority - right.priority);
  const kinds: ProviderConfigKind[] = ["chat", "embedding", "tts", "reranker"];

  return kinds.flatMap((kind) => {
    const databaseConfigs = records.filter((config) => config.kind === kind);
    const environmentConfig = getEnvironmentProviderConfig(kind);
    const configs = [...databaseConfigs, environmentConfig];

    return configs.map((config) => {
      const source = config.id === undefined ? "environment" : "database";
      const keyConfigured = hasProviderConfigApiKey(config, readEnvironmentApiKey(kind));
      const isDisabled =
        !config.isEnabled || (kind === "reranker" && config.provider === "disabled");
      const isConfigured =
        isDisabled ||
        (config.baseUrl.length > 0 &&
          (kind === "chat" || keyConfigured) &&
          config.provider.length > 0 &&
          config.model.length > 0);
      const failureCount = kind === "tts" ? params.failures[kind] : 0;

      return {
        apiKeyLast4: config.apiKeyLast4 ?? environmentConfig.apiKeyLast4,
        baseUrl: config.baseUrl,
        extraJson: config.extraJson ?? {},
        id: config.id,
        isEnabled: config.isEnabled,
        keyState: keyConfigured ? "configured" : "missing",
        kind,
        model: config.model,
        priority: config.priority,
        provider: config.provider,
        source,
        status:
          isDisabled
            ? "disabled"
            : !isConfigured
              ? "disabled"
              : failureCount > 0
                ? "degraded"
                : "configured",
        updatedAt: config.updatedAt?.toISOString(),
        updatedBy: config.updatedBy,
      };
    });
  });
}

function buildProviderConfigValues(params: {
  config: ProviderConfigUpdate;
  current?: ProviderConfigRecord;
  updatedBy: string;
}) {
  const apiKey = compactText(params.config.apiKey ?? "");
  const shouldClearApiKey = params.config.clearApiKey === true;
  const encryptedApiKey =
    apiKey.length > 0
      ? encryptApiKey(apiKey)
      : shouldClearApiKey
        ? null
        : params.current?.apiKeyCiphertext ?? null;
  const apiKeyLast4 =
    apiKey.length > 0
      ? toApiKeyLast4(apiKey)
      : shouldClearApiKey
        ? null
        : params.current?.apiKeyLast4 ?? null;

  return {
    apiKeyCiphertext: encryptedApiKey,
    apiKeyLast4,
    baseUrl: normalizeBaseUrl(compactText(params.config.baseUrl)),
    extraJson: params.config.extraJson ?? null,
    isEnabled: params.config.isEnabled ?? params.current?.isEnabled ?? true,
    kind: params.config.kind,
    model: compactText(params.config.model),
    priority:
      params.config.priority ?? params.current?.priority ?? getDefaultPriority(params.config.kind),
    provider: compactText(params.config.provider),
    updatedAt: new Date(),
    updatedBy: params.updatedBy,
  };
}

export async function createProviderConfig(params: {
  config: ProviderConfigUpdate;
  updatedBy: string;
}): Promise<ProviderConfigRecord> {
  const values = buildProviderConfigValues(params);

  const [row] = await db.insert(providerConfigs).values(values).returning();

  if (row === undefined) {
    throw new AppError("INTERNAL_ERROR", "Provider config was not saved.");
  }

  return toRecord(row);
}

export async function updateProviderConfigById(params: {
  config: ProviderConfigUpdate;
  id: string;
  kind?: ProviderConfigKind;
  updatedBy: string;
}): Promise<ProviderConfigRecord> {
  const current = await findProviderConfigById(params.id);

  if (current === undefined) {
    throw new AppError("NOT_FOUND", "Provider config not found.");
  }

  if (params.kind !== undefined && current.kind !== params.kind) {
    throw new AppError("NOT_FOUND", "Provider config not found.");
  }

  const values = buildProviderConfigValues({
    config: params.config,
    current,
    updatedBy: params.updatedBy,
  });

  const [row] = await db
    .update(providerConfigs)
    .set(values)
    .where(
      params.kind === undefined
        ? eq(providerConfigs.id, params.id)
        : and(eq(providerConfigs.id, params.id), eq(providerConfigs.kind, params.kind)),
    )
    .returning();

  if (row === undefined) {
    throw new AppError("NOT_FOUND", "Provider config not found.");
  }

  return toRecord(row);
}

export async function deleteProviderConfigById(params: {
  id: string;
  kind?: ProviderConfigKind;
}): Promise<ProviderConfigRecord> {
  const [row] = await db
    .delete(providerConfigs)
    .where(
      params.kind === undefined
        ? eq(providerConfigs.id, params.id)
        : and(eq(providerConfigs.id, params.id), eq(providerConfigs.kind, params.kind)),
    )
    .returning();

  if (row === undefined) {
    throw new AppError("NOT_FOUND", "Provider config not found.");
  }

  return toRecord(row);
}

export async function findProviderConfigById(
  id: string,
): Promise<ProviderConfigRecord | undefined> {
  const rows = await db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.id, id))
    .limit(1);

  const [row] = rows;

  return row === undefined ? undefined : toRecord(row);
}

export async function saveProviderConfig(params: {
  config: ProviderConfigUpdate;
  updatedBy: string;
}): Promise<ProviderConfigRecord> {
  const current = await findProviderConfig(params.config.kind);

  if (current !== undefined && current.id !== undefined) {
    return updateProviderConfigById({
      config: params.config,
      id: current.id,
      kind: params.config.kind,
      updatedBy: params.updatedBy,
    });
  }

  return createProviderConfig(params);
}

export async function resolveChatProviderConfigs(): Promise<ChatProviderConfig[]> {
  const configs = (await listProviderConfigsByKind("chat"))
    .filter((config) => config.isEnabled)
    .flatMap((config) => {
      const profile = readChatProviderProfile(config.extraJson);
      const apiKey = readProviderConfigApiKey(config, getChatEnvironmentApiKey(profile));

      return apiKey === undefined
        ? []
        : [
            {
              apiKey,
              baseUrl: config.baseUrl,
              profile,
              model: config.model,
              provider: config.provider,
            },
          ];
    });
  const fastEnvironmentConfig =
    env.aiFastBaseUrl.length > 0 && env.aiFastModel.length > 0 && env.aiFastProvider.length > 0
      ? [
          {
            apiKey: env.aiFastApiKey.length > 0 ? env.aiFastApiKey : env.aiApiKey,
            baseUrl: env.aiFastBaseUrl,
            profile: "fast" as const,
            model: env.aiFastModel,
            provider: env.aiFastProvider,
          },
        ]
      : [];

  return [
    ...configs,
    ...fastEnvironmentConfig,
    {
      apiKey: env.aiApiKey,
      baseUrl: env.aiBaseUrl,
      profile: "default",
      model: env.aiModel,
      provider: env.aiProvider,
    },
  ];
}

export async function resolveChatProviderConfig(): Promise<ChatProviderConfig> {
  const [config] = await resolveChatProviderConfigs();

  return config;
}

export async function resolveEmbeddingProviderConfigs(): Promise<EmbeddingProviderConfig[]> {
  const configs = (await listProviderConfigsByKind("embedding"))
    .filter((config) => config.isEnabled)
    .flatMap((config) => {
      const apiKey = readProviderConfigApiKey(config, env.embeddingApiKey);

      return apiKey === undefined
        ? []
        : [
            {
              apiKey,
              baseUrl: config.baseUrl,
              dimensions: readNumberExtra(config.extraJson, "dimensions", env.embeddingDimensions),
              model: config.model,
              provider: config.provider,
              version: readStringExtra(config.extraJson, "version", env.embeddingVersion),
            },
          ];
    })
    .filter((config) => config.dimensions === env.embeddingDimensions);

  return [
    ...configs,
    {
      apiKey: env.embeddingApiKey,
      baseUrl:
        env.embeddingBaseUrl.length > 0
          ? env.embeddingBaseUrl
          : defaultDashScopeEmbeddingBaseUrl,
      dimensions: env.embeddingDimensions,
      model: env.embeddingModel,
      provider: env.embeddingProvider,
      version: env.embeddingVersion,
    },
  ];
}

export async function resolveEmbeddingProviderConfig(): Promise<EmbeddingProviderConfig> {
  const [config] = await resolveEmbeddingProviderConfigs();

  return config;
}

export async function resolveTtsProviderConfigs(): Promise<TtsProviderConfig[]> {
  const configs = (await listProviderConfigsByKind("tts"))
    .filter((config) => config.isEnabled)
    .flatMap((config) => {
      const apiKey = readProviderConfigApiKey(config, env.ttsApiKey);

      return apiKey === undefined
        ? []
        : [
            {
              apiKey,
              baseUrl: config.baseUrl,
              model: config.model,
              provider: config.provider,
              voiceLeft: readStringExtra(config.extraJson, "voiceLeft", env.ttsVoiceLeft),
              voiceRight: readStringExtra(config.extraJson, "voiceRight", env.ttsVoiceRight),
            },
          ];
    });

  return [
    ...configs,
    {
      apiKey: env.ttsApiKey,
      baseUrl: env.ttsBaseUrl.length > 0 ? env.ttsBaseUrl : defaultDashScopeTtsBaseUrl,
      model: env.ttsModel,
      provider: env.ttsProvider,
      voiceLeft: env.ttsVoiceLeft,
      voiceRight: env.ttsVoiceRight,
    },
  ];
}

export async function resolveTtsProviderConfig(): Promise<TtsProviderConfig> {
  const [config] = await resolveTtsProviderConfigs();

  return config;
}

export async function resolveRerankerProviderConfigs(): Promise<RerankerProviderConfig[]> {
  const configs = (await listProviderConfigsByKind("reranker"))
    .filter((config) => config.isEnabled)
    .flatMap((config) => {
      const apiKey = readProviderConfigApiKey(config, env.rerankerApiKey);

      return apiKey === undefined
        ? []
        : [
            {
              apiKey,
              baseUrl: config.baseUrl,
              model: config.model,
              provider: config.provider,
            },
          ];
    });

  return [
    ...configs,
    {
      apiKey: env.rerankerApiKey,
      baseUrl: env.rerankerBaseUrl,
      model: env.rerankerModel,
      provider: env.rerankerProvider,
    },
  ];
}

export async function resolveRerankerProviderConfig(): Promise<RerankerProviderConfig> {
  const [config] = await resolveRerankerProviderConfigs();

  return config;
}
