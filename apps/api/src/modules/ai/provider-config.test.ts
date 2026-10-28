import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import {
  createProviderConfig,
  listProviderConfigViews,
  resolveChatProviderConfig,
  resolveChatProviderConfigs,
  resolveEmbeddingProviderConfigs,
  saveProviderConfig,
} from "./provider-config.js";

type ProviderConfigTestRow = {
  apiKeyCiphertext?: string | null;
  apiKeyLast4?: string | null;
  baseUrl: string;
  extraJson?: Record<string, unknown> | null;
  id?: string;
  isEnabled?: boolean;
  kind: "chat" | "embedding" | "reranker" | "tts";
  model: string;
  priority?: number;
  provider: string;
  updatedAt?: Date;
  updatedBy: string;
};

const testState = vi.hoisted(() => {
  const rows: ProviderConfigTestRow[] = [];
  let insertedValues: Record<string, unknown> | undefined;
  const defaultEnv = {
    aiApiKey: "",
    aiBaseUrl: "",
    aiFastApiKey: "",
    aiFastBaseUrl: "",
    aiFastModel: "",
    aiFastProvider: "",
    aiModel: "local-fallback",
    aiProvider: "openai-compatible",
    embeddingApiKey: "",
    embeddingBaseUrl: "",
    embeddingDimensions: 1024,
    embeddingModel: "text-embedding-v3",
    embeddingProvider: "dashscope",
    embeddingVersion: "v1",
    providerConfigSecret: "",
    rerankerApiKey: "",
    rerankerBaseUrl: "",
    rerankerModel: "local-disabled",
    rerankerProvider: "disabled",
    ttsApiKey: "",
    ttsBaseUrl: "",
    ttsModel: "cosyvoice-v3-flash",
    ttsProvider: "dashscope",
    ttsVoiceLeft: "longxiaochun",
    ttsVoiceRight: "longcheng",
  };
  const env = { ...defaultEnv };
  const limitMock = vi.fn<() => Promise<ProviderConfigTestRow[]>>(() => Promise.resolve([]));
  const orderByMock = vi.fn(() => Promise.resolve(rows));
  const whereMock = vi.fn(() => ({ limit: limitMock, orderBy: orderByMock }));
  const fromMock = vi.fn(
    (): { where: typeof whereMock } | Promise<ProviderConfigTestRow[]> => ({
      where: whereMock,
    }),
  );
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const returningMock = vi.fn<() => Promise<ProviderConfigTestRow[]>>(() =>
    Promise.resolve([]),
  );
  const onConflictDoUpdateMock = vi.fn(() => ({ returning: returningMock }));
  const valuesMock = vi.fn((values: Record<string, unknown>) => {
    insertedValues = values;

    return {
      onConflictDoUpdate: onConflictDoUpdateMock,
      returning: returningMock,
    };
  });
  const insertMock = vi.fn(() => ({ values: valuesMock }));
  const setMock = vi.fn(() => ({
    where: vi.fn(() => ({ returning: returningMock })),
  }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  const deleteMock = vi.fn(() => ({ where: vi.fn(() => ({ returning: returningMock })) }));

  return {
    fromMock,
    get insertedValues() {
      return insertedValues;
    },
    insertMock,
    limitMock,
    orderByMock,
    resetEnv() {
      Object.assign(env, defaultEnv);
    },
    resetInsertedValues() {
      insertedValues = undefined;
    },
    returningMock,
    rows,
    env,
    selectMock,
    setMock,
    deleteMock,
    updateMock,
    whereMock,
  };
});

vi.mock("../../config/env.js", () => {
  return {
    env: testState.env,
  };
});

vi.mock("../../db/client.js", () => {
  return {
    db: {
      delete: testState.deleteMock,
      insert: testState.insertMock,
      select: testState.selectMock,
      update: testState.updateMock,
    },
  };
});

vi.mock("../../db/schema.js", () => {
  return {
    providerConfigs: {
      createdAt: "createdAt",
      id: "id",
      kind: "kind",
      priority: "priority",
    },
  };
});

beforeEach(() => {
  testState.rows.length = 0;
  testState.resetInsertedValues();
  testState.resetEnv();
  vi.clearAllMocks();
  testState.limitMock.mockImplementation(() => Promise.resolve(testState.rows));
  testState.orderByMock.mockImplementation(() => Promise.resolve(testState.rows));
  testState.fromMock.mockImplementation(() => ({
    where: testState.whereMock,
  }));
  testState.selectMock.mockImplementation(() => ({
    from: testState.fromMock,
  }));
  testState.returningMock.mockImplementation(() =>
    Promise.resolve([
      {
        apiKeyCiphertext: (testState.insertedValues?.apiKeyCiphertext as string | null) ?? null,
        apiKeyLast4: (testState.insertedValues?.apiKeyLast4 as string | null) ?? null,
        baseUrl: (testState.insertedValues?.baseUrl as string) ?? "",
        extraJson:
          (testState.insertedValues?.extraJson as Record<string, unknown> | null) ?? null,
        id: "row-1",
        isEnabled: (testState.insertedValues?.isEnabled as boolean | undefined) ?? true,
        kind: (testState.insertedValues?.kind as ProviderConfigTestRow["kind"]) ?? "chat",
        model: (testState.insertedValues?.model as string) ?? "",
        priority: (testState.insertedValues?.priority as number | undefined) ?? 100,
        provider: (testState.insertedValues?.provider as string) ?? "",
        updatedAt: (testState.insertedValues?.updatedAt as Date) ?? new Date(),
        updatedBy: (testState.insertedValues?.updatedBy as string) ?? "",
      },
    ]),
  );
});

describe("provider config service", () => {
  it("uses environment config when no database override exists", async () => {
    const config = await resolveChatProviderConfig();

    expect(config).toMatchObject({
      baseUrl: "",
      model: "local-fallback",
      profile: "default",
      provider: "openai-compatible",
    });
  });

  it("marks database chat configs with the configured profile", async () => {
    testState.rows.push({
      apiKeyCiphertext: undefined,
      apiKeyLast4: undefined,
      baseUrl: "https://fast-chat.example.com/v1",
      extraJson: {
        chatProfile: "fast",
      },
      id: "row-fast-chat",
      isEnabled: true,
      kind: "chat",
      model: "fast-chat",
      priority: 10,
      provider: "openai-compatible",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });
    testState.rows.push({
      apiKeyCiphertext: undefined,
      apiKeyLast4: undefined,
      baseUrl: "https://default-chat.example.com/v1",
      extraJson: {},
      id: "row-default-chat",
      isEnabled: true,
      kind: "chat",
      model: "default-chat",
      priority: 20,
      provider: "openai-compatible",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });

    const configs = await resolveChatProviderConfigs();

    expect(configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseUrl: "https://fast-chat.example.com/v1",
          profile: "fast",
        }),
        expect.objectContaining({
          baseUrl: "https://default-chat.example.com/v1",
          profile: "default",
        }),
      ]),
    );
  });

  it("skips unreadable stored chat keys and keeps the environment fallback available", async () => {
    testState.env.aiApiKey = "env-chat-key";
    testState.env.aiBaseUrl = "https://env-chat.example.com/v1";
    testState.env.aiModel = "env-chat-model";
    testState.env.aiProvider = "openai-compatible";
    testState.rows.push({
      apiKeyCiphertext: "v1:bad:bad:bad",
      apiKeyLast4: "1234",
      baseUrl: "https://chat.example.com/v1",
      extraJson: {},
      id: "row-invalid-chat",
      isEnabled: true,
      kind: "chat",
      model: "deepseek-chat",
      priority: 10,
      provider: "openai-compatible",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });

    const configs = await resolveChatProviderConfigs();

    expect(configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          apiKey: "env-chat-key",
          baseUrl: "https://env-chat.example.com/v1",
          model: "env-chat-model",
          provider: "openai-compatible",
        }),
      ]),
    );
    expect(configs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseUrl: "https://chat.example.com/v1",
        }),
      ]),
    );
  });

  it("lists configured provider views without treating historical backlog as degraded", async () => {
    testState.env.providerConfigSecret = "provider-config-secret-with-32-chars";
    const chatConfig = await createProviderConfig({
      config: {
        apiKey: "secret-chat-1234",
        baseUrl: "https://chat.example.com/v1",
        extraJson: {},
        kind: "chat",
        model: "deepseek-chat",
        provider: "openai-compatible",
        priority: 10,
      },
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });
    const embeddingConfig = await createProviderConfig({
      config: {
        apiKey: "secret-embed-5678",
        baseUrl: "https://api.siliconflow.com/v1",
        extraJson: {
          dimensions: 1024,
          version: "qwen3-embedding-0.6b-1024",
        },
        kind: "embedding",
        model: "Qwen/Qwen3-Embedding-0.6B",
        provider: "siliconflow",
        priority: 20,
      },
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });
    testState.rows.push({
      apiKeyCiphertext: chatConfig.apiKeyCiphertext,
      apiKeyLast4: chatConfig.apiKeyLast4,
      baseUrl: chatConfig.baseUrl,
      extraJson: {},
      id: chatConfig.id,
      isEnabled: chatConfig.isEnabled,
      kind: "chat",
      model: chatConfig.model,
      priority: chatConfig.priority,
      provider: chatConfig.provider,
      updatedAt: chatConfig.updatedAt,
      updatedBy: chatConfig.updatedBy as string,
    });
    testState.rows.push({
      apiKeyCiphertext: embeddingConfig.apiKeyCiphertext,
      apiKeyLast4: embeddingConfig.apiKeyLast4,
      baseUrl: embeddingConfig.baseUrl,
      extraJson: {
        dimensions: 1024,
        version: "qwen3-embedding-0.6b-1024",
      },
      id: embeddingConfig.id,
      isEnabled: embeddingConfig.isEnabled,
      kind: "embedding",
      model: embeddingConfig.model,
      priority: embeddingConfig.priority,
      provider: embeddingConfig.provider,
      updatedAt: embeddingConfig.updatedAt,
      updatedBy: embeddingConfig.updatedBy as string,
    });
    testState.fromMock.mockImplementationOnce(() => Promise.resolve(testState.rows));

    const configs = await listProviderConfigViews({
      failures: {
        chat: 1,
        embedding: 3,
        reranker: 0,
        tts: 1,
      },
    });

    expect(configs[0]).toMatchObject({
      apiKeyLast4: "1234",
      id: expect.any(String),
      isEnabled: true,
      kind: "chat",
      keyState: "configured",
      priority: 10,
      source: "database",
      status: "configured",
    });
    expect(configs.find((config) => config.kind === "embedding")).toMatchObject({
      kind: "embedding",
      keyState: "configured",
      status: "configured",
    });
    expect(configs.find((config) => config.kind === "tts")).toMatchObject({
      kind: "tts",
      status: "disabled",
    });
    expect(JSON.stringify(configs)).not.toContain("encrypted");
  });

  it("rejects new api keys when PROVIDER_CONFIG_SECRET is missing", async () => {
    await expect(
      saveProviderConfig({
        config: {
          apiKey: "secret-key",
          baseUrl: "https://chat.example.com/v1",
          extraJson: {},
          kind: "chat",
          model: "deepseek-chat",
          provider: "openai-compatible",
        },
        updatedBy: "00000000-0000-4000-8000-000000000901",
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(testState.insertMock).not.toHaveBeenCalled();
  });

  it("saves non-key fields without an encryption secret", async () => {
    await createProviderConfig({
      config: {
        baseUrl: "https://chat.example.com/v1/",
        extraJson: {},
        kind: "chat",
        model: "deepseek-chat",
        provider: "openai-compatible",
      },
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });

    expect(testState.insertedValues).toMatchObject({
      apiKeyCiphertext: null,
      apiKeyLast4: null,
      baseUrl: "https://chat.example.com/v1",
      kind: "chat",
      priority: 100,
      model: "deepseek-chat",
    });
  });

  it("decrypts saved api keys when the provider config secret is stable", async () => {
    testState.env.providerConfigSecret = "provider-config-secret-with-32-chars";

    const saved = await createProviderConfig({
      config: {
        apiKey: "secret-key",
        baseUrl: "https://chat.example.com/v1",
        extraJson: {},
        kind: "chat",
        model: "deepseek-chat",
        provider: "openai-compatible",
      },
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });

    testState.rows.push({
      apiKeyCiphertext: saved.apiKeyCiphertext,
      apiKeyLast4: saved.apiKeyLast4,
      baseUrl: saved.baseUrl,
      extraJson: {},
      id: saved.id,
      isEnabled: saved.isEnabled,
      kind: "chat",
      model: saved.model,
      priority: saved.priority,
      provider: saved.provider,
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy as string,
    });

    const configs = await resolveChatProviderConfigs();

    expect(configs[0]).toMatchObject({
      apiKey: "secret-key",
      baseUrl: "https://chat.example.com/v1",
      model: "deepseek-chat",
      provider: "openai-compatible",
    });
  });

  it("keeps embedding fallback candidates on the configured vector dimension", async () => {
    testState.rows.push({
      apiKeyCiphertext: undefined,
      apiKeyLast4: undefined,
      baseUrl: "https://embedding-2048.example.com/v1",
      extraJson: {
        dimensions: 2048,
        version: "v2",
      },
      id: "row-2048",
      isEnabled: true,
      kind: "embedding",
      model: "text-embedding-v4",
      priority: 10,
      provider: "dashscope",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });
    testState.rows.push({
      apiKeyCiphertext: undefined,
      apiKeyLast4: undefined,
      baseUrl: "https://embedding-1024.example.com/v1",
      extraJson: {
        dimensions: 1024,
        version: "v1",
      },
      id: "row-1024",
      isEnabled: true,
      kind: "embedding",
      model: "text-embedding-v4",
      priority: 20,
      provider: "dashscope",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    });

    const configs = await resolveEmbeddingProviderConfigs();

    expect(configs[0]).toMatchObject({
      baseUrl: "https://embedding-1024.example.com/v1",
      dimensions: 1024,
    });
    expect(configs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          baseUrl: "https://embedding-2048.example.com/v1",
        }),
      ]),
    );
  });
});
