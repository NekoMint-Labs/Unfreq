import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import {
  deleteAdminSignal,
  generateAiSignals,
  getAdminSignals,
  getAdminSignalSummaries,
  keepAdminSignal,
  updateAdminSignalStatus,
} from "../signals/service.js";
import {
  listAdminAiReviewRecords,
  recordAdminAction,
  updateAdminFrequencyStatus,
} from "./repository.js";
import {
  createProviderConfig,
  deleteProviderConfigById,
  saveProviderConfig,
  updateProviderConfigById,
} from "../ai/provider-config.js";
import { testProviderConfig } from "../ai/provider-health.js";

const adminSignal = {
  audioStatus: "NOT_REQUESTED",
  createdAt: "2026-05-10T13:30:00.000Z",
  echoCount: 1,
  expandedText: "今晚想把这段匿名信号留在这里。",
  fingerprint: {
    energy: 0.5,
    frequency: "SIG-ADMIN",
    hiddenNeed: "希望被理解",
    narrativeConflict: "想靠近别人，又担心打扰别人",
    openness: 0.5,
    primaryEmotion: "孤独",
    riskLevel: "LOW",
    secondaryEmotions: ["等待"],
    signalType: "life-fragment",
    tags: ["孤独", "夜晚"],
    theme: "孤独",
    title: "后台信号",
  },
  id: "00000000-0000-4000-8000-000000000701",
  isKept: false,
  matches: [],
  program: {
    bridgeNarration: "两段信号在夜里短暂停靠。",
    closingQuestion: "你愿意继续留下这段同频吗？",
    hostIntro: "这里是 SIG-ADMIN。",
    leftSignalSummary: "今晚想把这段匿名信号留在这里。",
    programTitle: "后台信号 / 同频试播",
    shareQuote: "我在 SIG-ADMIN 留下了一段信号。",
  },
  qualityReason: "内容具体自然。",
  qualityScore: 4,
  rawInput: "我在末班地铁里反复想起今天的失误，想解释，又怕别人觉得我只是在找借口。",
  resonanceCount: 2,
  seedText: "我在末班地铁里反复想起今天的失误，想解释，又怕别人觉得我只是在找借口。",
  source: "ai_generated",
  status: "PUBLISHED",
  updatedAt: "2026-05-10T13:30:00.000Z",
} as const;

const adminSignalSummary = {
  audioStatus: "NOT_REQUESTED",
  createdAt: "2026-05-10T13:30:00.000Z",
  embedding: {
    dimensions: 1024,
    model: "text-embedding-v3",
    provider: "dashscope",
    status: "ready",
    version: "v1",
  },
  expandedText: "今晚想把这段匿名信号留在这里。",
  frequencyCode: "FM 21.07",
  galaxyPositionStatus: "ready",
  id: "00000000-0000-4000-8000-000000000701",
  resonanceCount: 2,
  seedText: "我在末班地铁里反复想起今天的失误。",
  source: "human",
  status: "PUBLISHED",
  updatedAt: "2026-05-10T13:30:00.000Z",
} as const;

const adminFrequency: AuthenticatedFrequency = {
  createdAt: "2026-05-10T00:00:00.000Z",
  freqCode: "FM-99.01",
  id: "00000000-0000-4000-8000-000000000901",
  role: "ADMIN",
  status: "ACTIVE",
};

const userFrequency: AuthenticatedFrequency = {
  createdAt: "2026-05-10T00:00:00.000Z",
  freqCode: "FM-27.51",
  id: "00000000-0000-4000-8000-000000000001",
  role: "USER",
  status: "ACTIVE",
};

vi.mock("../auth/service.js", () => {
  return {
    authenticateSessionToken: vi.fn((token: string) => {
      if (token === "admin-token") {
        return Promise.resolve(adminFrequency);
      }

      if (token === "user-token") {
        return Promise.resolve(userFrequency);
      }

      return Promise.resolve(undefined);
    }),
    getSessionTtlSeconds: vi.fn(() => 60 * 60 * 24 * 30),
    loginWithEmail: vi.fn(),
  };
});

vi.mock("./repository.js", () => {
  return {
    getAdminOverview: vi.fn(() => {
      return Promise.resolve({
        aiReviews: { total: 2 },
        aiOperations: {
          chatFallbacks: 1,
          embeddingFailures: 3,
          rerankerFailures: 0,
          ttsFailures: 1,
        },
        frequencies: { active: 9, banned: 1, muted: 2 },
        galaxy: { missingCoordinates: 4 },
        reports: { pending: 2, rejected: 1, resolved: 4 },
        signals: {
          deleted: 1,
          draft: 0,
          hidden: 2,
          published: 12,
          reviewing: 3,
          total: 18,
        },
        users: { active: 8, banned: 1, muted: 2 },
      });
    }),
    listAdminFrequencyRecords: vi.fn(() => {
      return Promise.resolve([
        {
          code: "FM 99.01",
          createdAt: "2026-05-10T00:00:00.000Z",
          id: adminFrequency.id,
          isGuest: true,
          lastSeenAt: "2026-05-10T13:00:00.000Z",
          role: "ADMIN",
          status: "ACTIVE",
        },
      ]);
    }),
    listAdminUserRecords: vi.fn(() => {
      return Promise.resolve([
        {
          createdAt: "2026-05-10T00:00:00.000Z",
          email: "admin@example.com",
          freqCode: "FM-99.01",
          id: adminFrequency.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      ]);
    }),
    listAdminAiReviewRecords: vi.fn(() => {
      return Promise.resolve([
        {
          createdAt: "2026-05-10T13:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000601",
          inputText: "我只是想把这段内容送出去。",
          model: "local-fallback",
          outputJson: {
            action: "ALLOW",
            reason: "未发现明显风险信号。",
            riskLevel: "LOW",
          },
          provider: "local",
          reviewType: "moderate",
          status: "SUCCEEDED",
          targetId: "00000000-0000-4000-8000-000000000701",
          targetType: "SIGNAL",
        },
      ]);
    }),
    recordAdminAction: vi.fn(() => Promise.resolve()),
    updateAdminFrequencyStatus: vi.fn(() => {
      return Promise.resolve({
        code: "FM 11.11",
        createdAt: "2026-05-10T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000902",
        isGuest: true,
        role: "USER",
        status: "BANNED",
      });
    }),
    updateAdminUserStatus: vi.fn(() => {
      return Promise.resolve({
        createdAt: "2026-05-10T00:00:00.000Z",
        email: "target@example.com",
        freqCode: "FM-11.11",
        id: "00000000-0000-4000-8000-000000000902",
        role: "USER",
        status: "BANNED",
      });
    }),
  };
});

vi.mock("../reports/service.js", () => {
  return {
    listReports: vi.fn(() => {
      return Promise.resolve([
        {
          createdAt: "2026-05-10T12:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000501",
          reason: "泄露隐私",
          reporterFreqCode: "FM-27.51",
          status: "PENDING",
          targetId: "00000000-0000-4000-8000-000000000701",
          targetType: "SIGNAL",
        },
      ]);
    }),
    resolveReport: vi.fn(() => {
      return Promise.resolve({
        createdAt: "2026-05-10T12:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000501",
        reason: "泄露隐私",
        reporterFreqCode: "FM-27.51",
        resolution: "已处理。",
        resolvedAt: "2026-05-10T12:05:00.000Z",
        status: "RESOLVED",
        targetId: "00000000-0000-4000-8000-000000000701",
        targetType: "SIGNAL",
      });
    }),
  };
});

vi.mock("../ai/provider-config.js", () => {
  const providerConfigs = [
    {
      apiKeyLast4: "sk01",
      baseUrl: "https://chat.example.com/v1",
      extraJson: {},
      id: "00000000-0000-4000-8000-000000000801",
      isEnabled: true,
      keyState: "configured",
      kind: "chat",
      model: "deepseek-chat",
      priority: 10,
      provider: "openai-compatible",
      source: "database",
      status: "degraded",
      updatedAt: "2026-05-10T12:00:00.000Z",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    },
    {
      apiKeyLast4: "cret",
      baseUrl: "https://backup.example.com/v1",
      extraJson: {},
      id: "00000000-0000-4000-8000-000000000802",
      isEnabled: true,
      keyState: "configured",
      kind: "chat",
      model: "backup-chat",
      priority: 20,
      provider: "openai-compatible",
      source: "database",
      status: "configured",
      updatedAt: "2026-05-10T12:05:00.000Z",
      updatedBy: "00000000-0000-4000-8000-000000000901",
    },
    {
      apiKeyLast4: "emb1",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      extraJson: {
        dimensions: 1024,
        version: "v1",
      },
      isEnabled: true,
      keyState: "configured",
      kind: "embedding",
      model: "text-embedding-v3",
      priority: 1000,
      provider: "dashscope",
      source: "environment",
      status: "degraded",
    },
    {
      baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
      extraJson: {
        voiceLeft: "longxiaochun",
        voiceRight: "longcheng",
      },
      isEnabled: true,
      keyState: "missing",
      kind: "tts",
      model: "cosyvoice-v3-flash",
      priority: 1000,
      provider: "dashscope",
      source: "environment",
      status: "disabled",
    },
    {
      baseUrl: "",
      extraJson: {},
      isEnabled: true,
      keyState: "missing",
      kind: "reranker",
      model: "local-disabled",
      priority: 1000,
      provider: "disabled",
      source: "environment",
      status: "disabled",
    },
  ];

  return {
    createProviderConfig: vi.fn(() =>
      Promise.resolve({
        apiKeyLast4: "cret",
        baseUrl: "https://backup.example.com/v1",
        extraJson: {},
        id: "00000000-0000-4000-8000-000000000802",
        isEnabled: true,
        kind: "chat",
        model: "backup-chat",
        priority: 20,
        provider: "openai-compatible",
        updatedAt: new Date("2026-05-10T12:05:00.000Z"),
        updatedBy: "00000000-0000-4000-8000-000000000901",
      }),
    ),
    deleteProviderConfigById: vi.fn(() =>
      Promise.resolve({
        apiKeyCiphertext: "encrypted-secret",
        apiKeyLast4: "cret",
        baseUrl: "https://backup.example.com/v1",
        extraJson: {},
        id: "00000000-0000-4000-8000-000000000802",
        isEnabled: true,
        kind: "chat",
        model: "backup-chat",
        priority: 20,
        provider: "openai-compatible",
        updatedAt: new Date("2026-05-10T12:05:00.000Z"),
        updatedBy: "00000000-0000-4000-8000-000000000901",
      }),
    ),
    findProviderConfigById: vi.fn(() => Promise.resolve(undefined)),
    listProviderConfigViews: vi.fn(() => Promise.resolve(providerConfigs)),
    readEnvironmentApiKey: vi.fn(() => "env-provider-key"),
    readProviderConfigApiKey: vi.fn(() => "stored-provider-key"),
    saveProviderConfig: vi.fn(() => Promise.resolve({})),
    updateProviderConfigById: vi.fn(() =>
      Promise.resolve({
        apiKeyLast4: "cret",
        baseUrl: "https://backup.example.com/v1",
        extraJson: {},
        id: "00000000-0000-4000-8000-000000000802",
        isEnabled: true,
        kind: "chat",
        model: "backup-chat",
        priority: 20,
        provider: "openai-compatible",
        updatedAt: new Date("2026-05-10T12:05:00.000Z"),
        updatedBy: "00000000-0000-4000-8000-000000000901",
      }),
    ),
  };
});

vi.mock("../ai/provider-health.js", () => {
  return {
    testProviderConfig: vi.fn(() =>
      Promise.resolve({
        checkedUrl: "https://chat.example.com/v1/chat/completions",
        detail: "Provider 可用，响应结构符合当前代码要求。",
        durationMs: 42,
        kind: "chat",
        model: "deepseek-chat",
        provider: "openai-compatible",
        reason: "ok",
        status: "passed",
      }),
    ),
  };
});

vi.mock("../signals/service.js", () => {
  return {
    deleteAdminSignal: vi.fn(() => {
      return Promise.resolve({
        ...adminSignal,
        status: "DELETED",
      });
    }),
    generateAiSignals: vi.fn(() => {
      return Promise.resolve({
        accepted: 1,
        attempts: 3,
        rejected: 0,
        results: [
          {
            persona: {
              age: 22,
              commonScenes: ["末班地铁"],
              currentConcern: "怕跟不上团队节奏",
              fmName: "FM-21.07",
              id: "late-night-intern",
              occupation: "实习生",
              style: "克制",
            },
            quality: {
              reason: "内容具体自然。",
              score: 4,
            },
            signal: adminSignal,
          },
        ],
      });
    }),
    getAdminSignals: vi.fn(() =>
      Promise.resolve({
        hasNextPage: false,
        items: [adminSignal],
        limit: 50,
        total: 1,
      }),
    ),
    getAdminSignalSummaries: vi.fn(() =>
      Promise.resolve({
        hasNextPage: false,
        items: [adminSignalSummary],
        limit: 50,
        total: 1,
      }),
    ),
    keepAdminSignal: vi.fn(() => {
      return Promise.resolve({
        ...adminSignal,
        isKept: true,
      });
    }),
    updateAdminSignalStatus: vi.fn(() => {
      return Promise.resolve({
        ...adminSignalSummary,
        status: "HIDDEN",
      });
    }),
  };
});

let app: FastifyInstance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("admin routes", () => {
  it("requires an admin frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const unauthenticatedResponse = await testApp.inject({
      method: "GET",
      url: "/api/admin/overview",
    });
    const userResponse = await testApp.inject({
      headers: {
        authorization: "Bearer user-token",
      },
      method: "GET",
      url: "/api/admin/overview",
    });

    expect(unauthenticatedResponse.statusCode).toBe(401);
    expect(userResponse.statusCode).toBe(403);
  });

  it("returns the admin overview for admins", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/overview",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        overview: {
          capabilities: {
            chat: "configured",
            embedding: "degraded",
            reranker: "disabled",
            tts: "disabled",
          },
          reports: {
            pending: 2,
          },
          signals: {
            total: 18,
          },
          users: {
            banned: 1,
          },
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });

  it("lists and updates provider configs without returning api keys", async () => {
    const testApp = await buildApp();
    app = testApp;

    const listResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/provider-configs",
    });
    const updateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PUT",
      payload: {
        apiKey: "sk-updated-secret",
        baseUrl: "https://chat.example.com/v1",
        extraJson: {},
        model: "deepseek-chat",
        provider: "openai-compatible",
      },
      url: "/api/admin/provider-configs/chat",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.providerConfigs[0]).toMatchObject({
      apiKeyLast4: "sk01",
      kind: "chat",
      keyState: "configured",
      status: "degraded",
    });
    expect(JSON.stringify(listResponse.json())).not.toContain("sk-updated-secret");
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.providerConfig).toMatchObject({
      kind: "chat",
      keyState: "configured",
    });
    expect(vi.mocked(saveProviderConfig)).toHaveBeenCalledWith({
      config: expect.objectContaining({
        apiKey: "sk-updated-secret",
        kind: "chat",
        model: "deepseek-chat",
      }),
      updatedBy: adminFrequency.id,
    });
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "provider_config.update",
        adminId: adminFrequency.id,
        details: expect.objectContaining({
          hasNewApiKey: true,
          kind: "chat",
        }),
        targetId: adminFrequency.id,
        targetType: "USER",
      }),
    );
  });

  it("creates, updates, and deletes provider backup configs without returning encrypted keys", async () => {
    const testApp = await buildApp();
    app = testApp;

    const backupId = "00000000-0000-4000-8000-000000000802";
    const createResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        apiKey: "sk-backup-secret",
        baseUrl: "https://backup.example.com/v1",
        extraJson: {},
        isEnabled: true,
        model: "backup-chat",
        priority: 20,
        provider: "openai-compatible",
      },
      url: "/api/admin/provider-configs/chat",
    });
    const updateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PUT",
      payload: {
        baseUrl: "https://backup.example.com/v1",
        extraJson: {},
        isEnabled: false,
        model: "backup-chat",
        priority: 30,
        provider: "openai-compatible",
      },
      url: `/api/admin/provider-configs/chat/${backupId}`,
    });
    const deleteResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "DELETE",
      url: `/api/admin/provider-configs/chat/${backupId}`,
    });

    expect(createResponse.statusCode).toBe(201);
    expect(updateResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().data.providerConfig).toMatchObject({
      apiKeyLast4: "cret",
      id: backupId,
      kind: "chat",
      keyState: "configured",
      priority: 20,
      source: "database",
    });
    expect(JSON.stringify(deleteResponse.json())).not.toContain("encrypted-secret");
    expect(vi.mocked(createProviderConfig)).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          apiKey: "sk-backup-secret",
          kind: "chat",
          priority: 20,
        }),
      }),
    );
    expect(vi.mocked(updateProviderConfigById)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: backupId,
        kind: "chat",
      }),
    );
    expect(vi.mocked(deleteProviderConfigById)).toHaveBeenCalledWith({
      id: backupId,
      kind: "chat",
    });
  });

  it("keeps environment provider config priority out of admin save payloads", async () => {
    const testApp = await buildApp();
    app = testApp;

    const updateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PUT",
      payload: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        extraJson: {
          dimensions: 1024,
          version: "v1",
        },
        isEnabled: true,
        model: "text-embedding-v3",
        provider: "dashscope",
      },
      url: "/api/admin/provider-configs/embedding",
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(vi.mocked(saveProviderConfig)).toHaveBeenCalledWith({
      config: expect.objectContaining({
        kind: "embedding",
        model: "text-embedding-v3",
        provider: "dashscope",
      }),
      updatedBy: adminFrequency.id,
    });
    expect(vi.mocked(saveProviderConfig)).not.toHaveBeenCalledWith({
      config: expect.objectContaining({
        priority: 1000,
      }),
      updatedBy: adminFrequency.id,
    });
  });

  it("tests provider config drafts without saving them", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        apiKey: "sk-test",
        baseUrl: "https://chat.example.com/v1",
        extraJson: {
          chatProfile: "default",
        },
        isEnabled: true,
        model: "deepseek-chat",
        provider: "openai-compatible",
      },
      url: "/api/admin/provider-configs/chat/test",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.result).toMatchObject({
      checkedUrl: "https://chat.example.com/v1/chat/completions",
      kind: "chat",
      reason: "ok",
      status: "passed",
    });
    expect(vi.mocked(testProviderConfig)).toHaveBeenCalledWith(
      "chat",
      expect.objectContaining({
        baseUrl: "https://chat.example.com/v1",
        model: "deepseek-chat",
        provider: "openai-compatible",
      }),
    );
    expect(vi.mocked(saveProviderConfig)).not.toHaveBeenCalled();
  });

  it("updates user statuses", async () => {
    const testApp = await buildApp();
    app = testApp;

    const userResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PATCH",
      payload: {
        status: "BANNED",
      },
      url: "/api/admin/users/00000000-0000-4000-8000-000000000902/status",
    });
    expect(userResponse.statusCode).toBe(200);
    expect(userResponse.json().data.user).toMatchObject({
      freqCode: "FM-11.11",
      status: "BANNED",
    });
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.status.update",
        adminId: adminFrequency.id,
        details: {
          status: "BANNED",
        },
        targetId: "00000000-0000-4000-8000-000000000902",
        targetType: "USER",
      }),
    );
  });

  it("lists and updates resonance signals", async () => {
    const testApp = await buildApp();
    app = testApp;

    const listResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/signals?source=human&status=PUBLISHED&limit=25&q=FM&cursor=abc",
    });
    const updateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PATCH",
      payload: {
        status: "HIDDEN",
      },
      url: "/api/admin/signals/00000000-0000-4000-8000-000000000701/status",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.signals.items[0]).toMatchObject({
      embedding: {
        status: "ready",
      },
      id: adminSignal.id,
      source: "human",
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.signal).toMatchObject({
      id: adminSignal.id,
      status: "HIDDEN",
    });
    expect(vi.mocked(getAdminSignalSummaries)).toHaveBeenCalledWith({
      source: "human",
      status: "PUBLISHED",
      limit: 25,
      q: "FM",
      cursor: "abc",
    });
    expect(vi.mocked(updateAdminSignalStatus)).toHaveBeenCalledWith({
      id: adminSignal.id,
      status: "HIDDEN",
    });
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "signal.status.update",
        adminId: adminFrequency.id,
        details: {
          status: "HIDDEN",
        },
        targetId: adminSignal.id,
        targetType: "SIGNAL",
      }),
    );
  });

  it("lists and updates frequency records", async () => {
    const testApp = await buildApp();
    app = testApp;

    const listResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/frequencies",
    });
    const updateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PATCH",
      payload: {
        status: "BANNED",
      },
      url: "/api/admin/frequencies/00000000-0000-4000-8000-000000000902/status",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.frequencies[0]).toMatchObject({
      code: "FM 99.01",
      role: "ADMIN",
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.frequency).toMatchObject({
      code: "FM 11.11",
      status: "BANNED",
    });
    expect(vi.mocked(updateAdminFrequencyStatus)).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000902",
      status: "BANNED",
    });
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "frequency.status.update",
        adminId: adminFrequency.id,
        details: {
          status: "BANNED",
        },
        targetId: "00000000-0000-4000-8000-000000000902",
        targetType: "USER",
      }),
    );
  });

  it("lists and resolves reports", async () => {
    const testApp = await buildApp();
    app = testApp;

    const listResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/reports?status=PENDING",
    });
    const updateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PATCH",
      payload: {
        resolution: "已处理。",
        status: "RESOLVED",
      },
      url: "/api/admin/reports/00000000-0000-4000-8000-000000000501",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.reports).toHaveLength(1);
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.report).toMatchObject({
      resolution: "已处理。",
      status: "RESOLVED",
    });
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "report.status.update",
        adminId: adminFrequency.id,
        details: {
          reportId: "00000000-0000-4000-8000-000000000501",
          resolution: "已处理。",
          status: "RESOLVED",
        },
        targetId: "00000000-0000-4000-8000-000000000701",
        targetType: "SIGNAL",
      }),
    );
  });

  it("lists ai review records", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/ai-reviews",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.aiReviews).toHaveLength(1);
    expect(response.json().data.aiReviews[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000601",
      reviewType: "moderate",
      status: "SUCCEEDED",
    });
    expect(vi.mocked(listAdminAiReviewRecords)).toHaveBeenCalledWith({});
  });

  it("returns reproducible ai evaluation metrics", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/ai-evaluation",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.evaluation).toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          method: "FINAL",
          metrics: expect.arrayContaining([
            expect.objectContaining({
              key: "matchTopKRelevance",
              unit: "percent",
            }),
          ]),
        }),
      ]),
      sampleSize: {
        classification: 4,
        matching: 2,
        moderation: 1,
        tags: 4,
      },
    });
  });

  it("lists, generates, keeps, and deletes admin ai signals", async () => {
    const testApp = await buildApp();
    app = testApp;

    const listResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "GET",
      url: "/api/admin/ai-signals?source=ai_generated",
    });
    const generateResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        count: 1,
      },
      url: "/api/admin/ai-signals/generate",
    });
    const keepResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "PATCH",
      payload: {
        isKept: true,
      },
      url: "/api/admin/ai-signals/00000000-0000-4000-8000-000000000701/keep",
    });
    const deleteResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "DELETE",
      url: "/api/admin/ai-signals/00000000-0000-4000-8000-000000000701",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data.signals.items[0]).toMatchObject({
      id: adminSignal.id,
      qualityScore: 4,
      source: "ai_generated",
    });
    expect(generateResponse.statusCode).toBe(201);
    expect(generateResponse.json().data.generation).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
    expect(keepResponse.statusCode).toBe(200);
    expect(keepResponse.json().data.signal).toMatchObject({
      id: adminSignal.id,
      isKept: true,
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json().data.signal).toMatchObject({
      id: adminSignal.id,
      status: "DELETED",
    });
    expect(vi.mocked(getAdminSignals)).toHaveBeenCalledWith({
      source: "ai_generated",
    });
    expect(vi.mocked(generateAiSignals)).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
    );
    expect(vi.mocked(keepAdminSignal)).toHaveBeenCalledWith({
      id: adminSignal.id,
      isKept: true,
    });
    expect(vi.mocked(deleteAdminSignal)).toHaveBeenCalledWith(adminSignal.id);
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "signal.keep.update",
        targetId: adminSignal.id,
        targetType: "SIGNAL",
      }),
    );
    expect(vi.mocked(recordAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "signal.delete",
        targetId: adminSignal.id,
        targetType: "SIGNAL",
      }),
    );
  });
});
