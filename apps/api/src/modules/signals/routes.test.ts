import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type {
  CreateSignalInput,
  SavedSignalRecord,
  SignalEchoRecord,
  SignalFingerprint,
  SignalRecord,
  SignalResonanceResult,
  SignalStatus,
} from "./types.js";

const signalStores = vi.hoisted(() => {
  return {
    echoes: [] as SignalEchoRecord[],
    lastSeenAtByFrequencyId: new Map<string, Date | null>(),
    resonances: new Set<string>(),
    rows: [] as SignalRecord[],
    saves: new Set<string>(),
  };
});

const routeExpansion = vi.hoisted(() => {
  return {
    expandedText:
      "屏幕暗下去的时候，房间里只剩空调细小的声响，我把杯沿转了一圈，又停住。今晚想把这段匿名信号留在这里这件事没有被我说得很重，却一直在旁边。那一点停顿比解释更早露出来。",
    followUpQuestion: "你最近把哪句话留在了原地？",
  };
});

vi.mock("../auth/service.js", () => {
  const frequency: AuthenticatedFrequency = {
    createdAt: "2026-05-10T00:00:00.000Z",
    freqCode: "FM-27.51",
    id: "00000000-0000-4000-8000-000000000301",
    role: "USER",
    status: "ACTIVE",
  };
  const adminFrequency: AuthenticatedFrequency = {
    createdAt: "2026-05-10T00:00:00.000Z",
    freqCode: "FM-99.01",
    id: "00000000-0000-4000-8000-000000000302",
    role: "ADMIN",
    status: "ACTIVE",
  };
  const otherFrequency: AuthenticatedFrequency = {
    createdAt: "2026-05-10T00:00:00.000Z",
    freqCode: "FM-44.03",
    id: "00000000-0000-4000-8000-000000000303",
    role: "USER",
    status: "ACTIVE",
  };

  return {
    authenticateSessionToken: vi.fn((token: string) => {
      if (token === "active-token") {
        return Promise.resolve(frequency);
      }

      if (token === "admin-token") {
        return Promise.resolve(adminFrequency);
      }

      if (token === "other-token") {
        return Promise.resolve(otherFrequency);
      }

      return Promise.resolve(undefined);
    }),
    getSessionTtlSeconds: vi.fn(() => 60 * 60 * 24 * 30),
  };
});

vi.mock("../ai/service.js", () => {
  const fingerprint: SignalFingerprint = {
    coreNeed: "希望被理解",
    displayText: "关系星云 · 被理解需求",
    energy: 0.48,
    emotionTone: "安静孤独",
    frequency: "SIG-ROUTE",
    hiddenNeed: "希望被理解",
    innerConflict: "想靠近别人，又担心打扰别人",
    narrativeConflict: "想靠近别人，又担心打扰别人",
    openness: 0.45,
    primaryBand: "relationship_nebula",
    primaryEmotion: "孤独",
    resonanceKeywords: ["孤独", "夜晚"],
    riskLevel: "LOW",
    secondaryEmotions: ["等待"],
    signalType: "relationship_nebula",
    subFeeling: "need_to_be_understood",
    tags: ["孤独", "夜晚"],
    theme: "关系星云",
    title: "匿名信号",
  };
  const classification = {
    allowedInventions: ["日常物件", "一个小动作"],
    confidence: 0.7,
    energy: "medium" as const,
    expansionMode: "light_scene" as const,
    forbiddenInventions: ["完整剧情", "诊断", "人生总结"],
    inputKind: "wish" as const,
    intendedFocus: "把等待同频回应的想法留在一个安静的日常动作里",
    inventionLevel: "medium" as const,
    keywords: ["匿名信号", "同频"],
    mustAvoid: [],
    mood: "quiet",
    preserve: ["今晚想把这段匿名信号留在这里"],
    sceneHint: "屏幕暗下去后的房间和停住的手部动作",
    shouldBeNegative: false,
    type: "daily_wish" as const,
    userAct: "make_wish" as const,
  };

  return {
    analyzeSignalIntentWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: classification,
        reviewId: "00000000-0000-4000-8000-000000000912",
      });
    }),
    classifySignalSeedWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: classification,
        reviewId: "00000000-0000-4000-8000-000000000907",
      });
    }),
    generateSignalExpansionWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: routeExpansion,
        reviewId: "00000000-0000-4000-8000-000000000908",
      });
    }),
    generateSignalFingerprintWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: fingerprint,
        reviewId: "00000000-0000-4000-8000-000000000901",
      });
    }),
    generateSignalContentWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: {
          rawInput: "我在末班地铁里反复想起今天的失误，想解释，又怕别人觉得我只是在找借口。",
        },
        reviewId: "00000000-0000-4000-8000-000000000905",
      });
    }),
    reviewSignalExpansionWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: {
          hasConcreteObjects: true,
          hasSensoryDetails: true,
          isForcedNegative: false,
          isGenericLiteraryTemplate: false,
          matchesSeedType: true,
          pass: true,
          preservesOriginalDirection: true,
          problems: [],
          rewriteInstruction: "",
          score: 8.5,
        },
        reviewId: "00000000-0000-4000-8000-000000000909",
      });
    }),
    scoreSignalQualityWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: {
          reason: "内容具体自然。",
          score: 4,
        },
        reviewId: "00000000-0000-4000-8000-000000000906",
      });
    }),
  };
});

vi.mock("./repository.js", () => {
  class SignalNotFoundForInteraction extends Error {
    constructor() {
      super("Signal not found for interaction.");
      this.name = "SignalNotFoundForInteraction";
    }
  }

  const findSignal = (id: string) => {
    return signalStores.rows.find((row) => row.id === id);
  };
  const isPublicCompletedSignal = (row: SignalRecord) => {
    return row.status === "PUBLISHED" && row.generationStatus === "COMPLETED";
  };

  return {
    SignalNotFoundForInteraction,
    createSignalDraft: vi.fn((input: CreateSignalInput) => {
      const now = new Date("2026-05-10T12:00:00.000Z");
      const signal: SignalRecord = {
        authorFreqCode: input.authorId === undefined ? null : "FM-27.51",
        authorId: input.authorId ?? null,
        audioError: null,
        audioStatus: "NOT_REQUESTED",
        audioStorageKey: null,
        audioStorageKeyLeft: null,
        audioStorageKeyRight: null,
        audioUrl: null,
        audioUrlLeft: null,
        audioUrlRight: null,
        createdAt: now,
        echoCount: 0,
        embedding: null,
        embeddingDimensions: null,
        embeddingModel: null,
        embeddingProvider: null,
        embeddingVersion: null,
        expandedText: input.expandedText ?? input.rawInput,
        fingerprintJson: input.fingerprint,
        followUpQuestion: input.followUpQuestion ?? null,
        frequencyId: input.frequencyId ?? null,
        galaxyPosition: input.galaxyPosition ?? null,
        generationError: input.generationError ?? null,
        generationStatus: input.generationStatus ?? "COMPLETED",
        guestKey: input.guestKey ?? null,
        id: `00000000-0000-4000-8000-${String(signalStores.rows.length + 1).padStart(12, "0")}`,
        coreNeed: input.frequencyProfile?.coreNeed ?? null,
        emotionTone: input.frequencyProfile?.emotionTone ?? null,
        innerConflict: input.frequencyProfile?.innerConflict ?? null,
        matchSignalId: input.matchSignalId ?? null,
        parentSignalId: input.parentSignalId ?? null,
        primaryBand: input.frequencyProfile?.primaryBand ?? null,
        programJson: input.program,
        qualityReason: input.qualityReason ?? null,
        qualityScore: input.qualityScore ?? null,
        rawInput: input.rawInput,
        resonanceCount: 0,
        resonanceKeywords: input.frequencyProfile?.resonanceKeywords ?? null,
        seedText: input.seedText ?? input.rawInput,
        source: input.source ?? "human",
        status: input.status ?? "DRAFT",
        subFeeling: input.frequencyProfile?.subFeeling ?? null,
        isKept: false,
        updatedAt: now,
      };

      signalStores.rows.push(signal);

      return Promise.resolve(signal);
    }),
    completeSignalGeneration: vi.fn((params: { id: string; input: CreateSignalInput }) => {
      const signal = findSignal(params.id);

      if (signal === undefined) {
        return Promise.resolve(undefined);
      }

      signal.authorId = params.input.authorId ?? null;
      signal.authorFreqCode = params.input.authorId === undefined ? null : "FM-27.51";
      signal.expandedText = params.input.expandedText ?? params.input.rawInput;
      signal.fingerprintJson = params.input.fingerprint;
      signal.followUpQuestion = params.input.followUpQuestion ?? null;
      signal.frequencyId = params.input.frequencyId ?? null;
      signal.galaxyPosition = params.input.galaxyPosition ?? null;
      signal.generationError = null;
      signal.generationStatus = "COMPLETED";
      signal.guestKey = params.input.guestKey ?? null;
      signal.coreNeed = params.input.frequencyProfile?.coreNeed ?? null;
      signal.emotionTone = params.input.frequencyProfile?.emotionTone ?? null;
      signal.innerConflict = params.input.frequencyProfile?.innerConflict ?? null;
      signal.matchSignalId = params.input.matchSignalId ?? null;
      signal.parentSignalId = params.input.parentSignalId ?? null;
      signal.primaryBand = params.input.frequencyProfile?.primaryBand ?? null;
      signal.programJson = params.input.program;
      signal.qualityReason = params.input.qualityReason ?? null;
      signal.qualityScore = params.input.qualityScore ?? null;
      signal.rawInput = params.input.rawInput;
      signal.resonanceKeywords = params.input.frequencyProfile?.resonanceKeywords ?? null;
      signal.seedText = params.input.seedText ?? params.input.rawInput;
      signal.source = params.input.source ?? "human";
      signal.status = params.input.status ?? "DRAFT";
      signal.subFeeling = params.input.frequencyProfile?.subFeeling ?? null;
      signal.updatedAt = new Date("2026-05-10T12:01:00.000Z");

      return Promise.resolve(signal);
    }),
    listPublishedSignals: vi.fn(() => {
      return Promise.resolve(
        signalStores.rows.filter(isPublicCompletedSignal),
      );
    }),
    listPublishedGalaxySignals: vi.fn((params?: { band?: string; theme?: string }) => {
      return Promise.resolve(
        signalStores.rows.filter((row) => {
          return (
            isPublicCompletedSignal(row) &&
            (params?.band === undefined || row.primaryBand === params.band) &&
            (params?.theme === undefined || row.fingerprintJson.theme === params.theme)
          );
        }),
      );
    }),
    listPublishedGalaxyThemes: vi.fn(() => {
      return Promise.resolve(
        Array.from(
          new Set(
            signalStores.rows
              .filter(isPublicCompletedSignal)
              .map((row) => row.primaryBand ?? row.fingerprintJson.theme)
              .filter((theme) => theme.length > 0),
          ),
        ).sort((left, right) => left.localeCompare(right, "zh-CN")),
      );
    }),
    listSignalsForAuthor: vi.fn((params: { authorId: string; limit: number }) => {
      return Promise.resolve(
        signalStores.rows
          .filter((row) => {
            return (
              row.authorId === params.authorId &&
              row.generationStatus === "COMPLETED" &&
              row.status !== "DELETED"
            );
          })
          .slice(0, params.limit),
      );
    }),
    findRandomPublishedSignal: vi.fn((params?: { excludeFrequencyId?: string }) => {
      return Promise.resolve(
        signalStores.rows.find((row) => {
          const ownerId = row.frequencyId ?? row.authorId;

          return (
            isPublicCompletedSignal(row) &&
            (params?.excludeFrequencyId === undefined || ownerId !== params.excludeFrequencyId)
          );
        }),
      );
    }),
    getFrequencyLastSeenAt: vi.fn((frequencyId: string) => {
      return Promise.resolve(signalStores.lastSeenAtByFrequencyId.get(frequencyId) ?? null);
    }),
    listPublishedSignalMatchCandidates: vi.fn(() => {
      return Promise.resolve(
        signalStores.rows.filter(isPublicCompletedSignal),
      );
    }),
    findPublishedSignalById: vi.fn((id: string) => {
      return Promise.resolve(
        signalStores.rows.find((row) => row.id === id && isPublicCompletedSignal(row)),
      );
    }),
    findSignalResultById: vi.fn((id: string) => {
      return Promise.resolve(
        signalStores.rows.find((row) => row.id === id && row.status !== "DELETED"),
      );
    }),
    publishSignalForFrequency: vi.fn((params: { frequencyId: string; id: string }) => {
      const signal = signalStores.rows.find((row) => {
        const ownerId = row.frequencyId ?? row.authorId;

        return (
          row.id === params.id &&
          row.status === "DRAFT" &&
          row.generationStatus === "COMPLETED" &&
          ownerId === params.frequencyId
        );
      });

      if (signal !== undefined) {
        signal.status = "PUBLISHED";
        signal.updatedAt = new Date("2026-05-10T12:02:00.000Z");
      }

      return Promise.resolve(signal);
    }),
    findVisibleSignalForFrequency: vi.fn((params: { frequencyId: string; id: string }) => {
      return Promise.resolve(
        signalStores.rows.find((row) => {
          const ownerId = row.frequencyId ?? row.authorId;

          return (
            row.id === params.id &&
            row.generationStatus === "COMPLETED" &&
            row.status !== "DELETED" &&
            ownerId === params.frequencyId
          );
        }),
      );
    }),
    markSignalAudioFailed: vi.fn(
      (params: { error: string; id: string }) => {
        const signal = findSignal(params.id);

        if (signal !== undefined) {
          signal.audioError = params.error;
          signal.audioStatus = "FAILED";
        }

        return Promise.resolve(signal);
      },
    ),
    markSignalAudioPending: vi.fn((id: string) => {
      const signal = findSignal(id);

      if (signal !== undefined) {
        signal.audioError = null;
        signal.audioStatus = "PENDING";
      }

      return Promise.resolve(signal);
    }),
    markSignalAudioReady: vi.fn(
      (params: {
        id: string;
        storageKey?: string;
        storageKeyLeft: string;
        storageKeyRight: string;
        url?: string;
        urlLeft: string;
        urlRight: string;
      }) => {
        const signal = findSignal(params.id);

        if (signal !== undefined) {
          signal.audioError = null;
          signal.audioStatus = "READY";
          signal.audioStorageKey = params.storageKey ?? params.storageKeyLeft;
          signal.audioStorageKeyLeft = params.storageKeyLeft;
          signal.audioStorageKeyRight = params.storageKeyRight;
          signal.audioUrl = params.url ?? params.urlLeft;
          signal.audioUrlLeft = params.urlLeft;
          signal.audioUrlRight = params.urlRight;
        }

        return Promise.resolve(signal);
      },
    ),
    updateSignalGenerationStatus: vi.fn(
      (params: { error?: string | null; id: string; status: SignalRecord["generationStatus"] }) => {
        const signal = findSignal(params.id);

        if (signal !== undefined) {
          signal.generationError = params.error ?? null;
          signal.generationStatus = params.status;
          signal.updatedAt = new Date("2026-05-10T12:01:00.000Z");
        }

        return Promise.resolve(signal);
      },
    ),
    createSignalEcho: vi.fn(
      (params: { authorId?: string; content: string; guestKey?: string; signalId: string }) => {
        const signal = signalStores.rows.find((row) => {
          return row.id === params.signalId && isPublicCompletedSignal(row);
        });

        if (signal === undefined) {
          throw new SignalNotFoundForInteraction();
        }

        const echo: SignalEchoRecord = {
          authorFreqCode: params.authorId === undefined ? null : "FM-27.51",
          authorId: params.authorId ?? null,
          content: params.content,
          createdAt: new Date("2026-05-10T12:02:00.000Z"),
          guestKey: params.guestKey ?? null,
          id: `00000000-0000-4000-8000-${String(signalStores.echoes.length + 101).padStart(12, "0")}`,
          signalId: params.signalId,
          status: "PUBLISHED",
          updatedAt: new Date("2026-05-10T12:02:00.000Z"),
        };

        signal.echoCount += 1;
        signalStores.echoes.push(echo);

        return Promise.resolve(echo);
      },
    ),
    createSignalEchoForPersona: vi.fn(
      (params: { content: string; guestKey: string; signalId: string }) => {
        return Promise.resolve({
          authorFreqCode: null,
          authorId: null,
          content: params.content,
          createdAt: new Date("2026-05-10T12:03:00.000Z"),
          guestKey: params.guestKey,
          id: `00000000-0000-4000-8000-${String(signalStores.echoes.length + 201).padStart(12, "0")}`,
          signalId: params.signalId,
          status: "PUBLISHED",
          updatedAt: new Date("2026-05-10T12:03:00.000Z"),
        });
      },
    ),
    createSignalResonance: vi.fn(
      (params: {
        actorKey: string;
        authorId?: string;
        guestKey?: string;
        signalId: string;
      }): Promise<SignalResonanceResult> => {
        const signal = signalStores.rows.find((row) => {
          return row.id === params.signalId && isPublicCompletedSignal(row);
        });

        if (signal === undefined) {
          throw new SignalNotFoundForInteraction();
        }

        const key = `${params.signalId}:${params.actorKey}`;

        if (!signalStores.resonances.has(key)) {
          signalStores.resonances.add(key);
          signal.resonanceCount += 1;
        }

        return Promise.resolve({
          hasResonated: true,
          resonanceCount: signal.resonanceCount,
        });
      },
    ),
    createSignalResonanceForPersona: vi.fn(
      (params: { actorKey: string; guestKey: string; signalId: string }) => {
        const key = `${params.signalId}:${params.actorKey}`;
        signalStores.resonances.add(key);

        return Promise.resolve({
          hasResonated: true,
          resonanceCount: signalStores.resonances.size,
        });
      },
    ),
    createSignalSave: vi.fn((params: {
      frequencyId: string;
      signalId: string;
    }) => {
      const signal = signalStores.rows.find((row) => {
        return row.id === params.signalId && isPublicCompletedSignal(row);
      });

      if (signal === undefined) {
        throw new SignalNotFoundForInteraction();
      }

      signalStores.saves.add(`${params.frequencyId}:${params.signalId}`);

      return Promise.resolve({
        hasSaved: true,
      });
    }),
    deleteSignalSave: vi.fn((params: {
      frequencyId: string;
      signalId: string;
    }) => {
      signalStores.saves.delete(`${params.frequencyId}:${params.signalId}`);

      return Promise.resolve({
        hasSaved: false,
      });
    }),
    findSignalSave: vi.fn((params: {
      frequencyId: string;
      signalId: string;
    }) => {
      return Promise.resolve(
        signalStores.saves.has(`${params.frequencyId}:${params.signalId}`)
          ? { id: "00000000-0000-4000-8000-000000000701" }
          : undefined,
      );
    }),
    deleteSignalByAdmin: vi.fn((id: string) => {
      const signal = findSignal(id);

      if (signal !== undefined) {
        signal.status = "DELETED";
      }

      return Promise.resolve(signal);
    }),
    deleteSignalResonance: vi.fn(
      (params: { actorKey: string; signalId: string }): Promise<SignalResonanceResult> => {
        const signal = signalStores.rows.find((row) => {
          return row.id === params.signalId && isPublicCompletedSignal(row);
        });

        if (signal === undefined) {
          throw new SignalNotFoundForInteraction();
        }

        const key = `${params.signalId}:${params.actorKey}`;

        if (signalStores.resonances.delete(key)) {
          signal.resonanceCount = Math.max(signal.resonanceCount - 1, 0);
        }

        return Promise.resolve({
          hasResonated: false,
          resonanceCount: signal.resonanceCount,
        });
      },
    ),
    listPublishedSignalEchoes: vi.fn((signalId: string) => {
      return Promise.resolve(
        signalStores.echoes.filter((echo) => {
          const signal = signalStores.rows.find((row) => row.id === signalId);

          return (
            echo.signalId === signalId &&
            echo.status === "PUBLISHED" &&
            signal !== undefined &&
            isPublicCompletedSignal(signal)
          );
        }),
      );
    }),
    listSavedSignalsForFrequency: vi.fn((params: { frequencyId: string; limit: number }) => {
      const savedAt = new Date("2026-05-10T12:04:00.000Z");

      return Promise.resolve(
        signalStores.rows
          .filter((row) => {
            return (
              isPublicCompletedSignal(row) &&
              signalStores.saves.has(`${params.frequencyId}:${row.id}`)
            );
          })
          .slice(0, params.limit)
          .map((row): SavedSignalRecord => {
            return {
              ...row,
              savedAt,
            };
          }),
      );
    }),
    listAdminSignals: vi.fn((params: { source?: SignalRecord["source"] }) => {
      return Promise.resolve(
        signalStores.rows.filter((row) => {
          return params.source === undefined || row.source === params.source;
        }),
      );
    }),
    listPublishedSemanticSignalMatchCandidates: vi.fn(() => Promise.resolve([])),
    summarizeSignalResonancesSince: vi.fn((params: { authorId: string; since: Date }) => {
      const rows = signalStores.rows.filter((row) => {
        return row.authorId === params.authorId && row.status !== "DELETED";
      });
      const resonanceCountBySignalId = new Map<string, number>();

      signalStores.resonances.forEach((key) => {
        const [signalId] = key.split(":");
        const signal = rows.find((row) => row.id === signalId);

        if (signal !== undefined) {
          resonanceCountBySignalId.set(
            signalId,
            (resonanceCountBySignalId.get(signalId) ?? 0) + 1,
          );
        }
      });

      const topSignalId = Array.from(resonanceCountBySignalId.entries()).sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0]);
      })[0]?.[0];

      return Promise.resolve({
        newResonanceCount: Array.from(resonanceCountBySignalId.values()).reduce(
          (total, count) => total + count,
          0,
        ),
        topSignal:
          topSignalId === undefined
            ? undefined
            : rows.find((row) => row.id === topSignalId),
      });
    }),
    touchFrequencyLastSeenAt: vi.fn((params: { frequencyId: string; seenAt: Date }) => {
      signalStores.lastSeenAtByFrequencyId.set(params.frequencyId, params.seenAt);

      return Promise.resolve();
    }),
    markSignalKeptByAdmin: vi.fn((params: { id: string; isKept: boolean }) => {
      const signal = findSignal(params.id);

      if (signal !== undefined) {
        signal.isKept = params.isKept;
      }

      return Promise.resolve(signal);
    }),
    writeSignalEmbeddingIfMissing: vi.fn(() => Promise.resolve(true)),
    writeSignalGalaxyPositionIfMissing: vi.fn((params: {
      id: string;
      position: { x: number; y: number; z: number };
    }) => {
      const signal = findSignal(params.id);

      if (signal !== undefined && signal.galaxyPosition === null) {
        signal.galaxyPosition = params.position;
      }

      return Promise.resolve(signal !== undefined);
    }),
  };
});

vi.mock("./audio-storage.js", () => {
  return {
    buildSignalAudioStorageKey: vi.fn((signalId: string, channel: "left" | "main" | "right") => {
      if (channel === "main") {
        return `${signalId}.mp3`;
      }

      return `${signalId}-${channel}.mp3`;
    }),
    readSignalAudio: vi.fn(() => {
      return Promise.resolve(Buffer.from("audio"));
    }),
    writeSignalAudio: vi.fn(() => Promise.resolve()),
  };
});

let app: FastifyInstance | undefined;

beforeEach(() => {
  signalStores.echoes = [];
  signalStores.lastSeenAtByFrequencyId = new Map<string, Date | null>();
  signalStores.resonances = new Set<string>();
  signalStores.rows = [];
  signalStores.saves = new Set<string>();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function waitForSignalCompleted(id: string) {
  await vi.waitFor(() => {
    const signal = signalStores.rows.find((row) => row.id === id);
    expect(signal?.generationStatus).toBe("COMPLETED");
  });
}

function setSignalStatus(id: string, status: SignalStatus) {
  const signal = signalStores.rows.find((row) => row.id === id);

  if (signal !== undefined) {
    signal.status = status;
  }
}

async function createSignal(testApp: FastifyInstance, status?: SignalStatus) {
  const response = await testApp.inject({
    headers: {
      authorization: "Bearer active-token",
    },
    method: "POST",
    payload: {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    },
    url: "/api/signals",
  });

  if (status !== undefined) {
    await waitForSignalCompleted(response.json().data.signal.id);
    setSignalStatus(response.json().data.signal.id, status);
  } else {
    await waitForSignalCompleted(response.json().data.signal.id);
  }

  return response.json().data.signal as { id: string };
}

describe("signal routes", () => {
  it("creates a pending signal and completes generation for the current frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        signal: {
          generationStatus: "RECEIVED",
          seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
          status: "DRAFT",
          visibility: "GENERATION_OWNER",
        },
      },
    });
    await vi.waitFor(() => {
      expect(signalStores.rows[0]).toMatchObject({
        expandedText: routeExpansion.expandedText,
        followUpQuestion: routeExpansion.followUpQuestion,
        generationStatus: "COMPLETED",
        status: "DRAFT",
      });
    });
    expect(signalStores.rows).toHaveLength(1);
    expect(signalStores.rows[0]).toMatchObject({
      rawInput: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      status: "DRAFT",
    });
  });

  it("exposes completed draft previews only to the owner", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const ownerResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });
    const nonOwnerResponse = await testApp.inject({
      headers: {
        authorization: "Bearer other-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });
    const anonymousResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json()).toMatchObject({
      data: {
        signal: {
          expandedText: routeExpansion.expandedText,
          id: signal.id,
          status: "DRAFT",
          visibility: "PREVIEW_OWNER",
        },
      },
    });
    expect(nonOwnerResponse.statusCode).toBe(404);
    expect(anonymousResponse.statusCode).toBe(404);
  });

  it("hides completed draft previews from public signal surfaces", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const hallResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/hall",
    });
    const galaxyResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/galaxy",
    });
    const randomResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/random",
    });
    const matchesResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}/matches`,
    });
    const saveResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      url: `/api/signals/${signal.id}/save`,
    });
    const resonanceResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signal.id}/resonance`,
    });

    expect(hallResponse.statusCode).toBe(200);
    expect(hallResponse.json()).toMatchObject({
      data: {
        signals: [],
      },
    });
    expect(galaxyResponse.statusCode).toBe(200);
    expect(galaxyResponse.json()).toMatchObject({
      data: {
        points: [],
      },
    });
    expect(randomResponse.statusCode).toBe(404);
    expect(matchesResponse.statusCode).toBe(404);
    expect(saveResponse.statusCode).toBe(404);
    expect(resonanceResponse.statusCode).toBe(404);
  });

  it("publishes a completed draft preview for the owner", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const publishResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signal.id}/publish`,
    });
    const publicResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json()).toMatchObject({
      data: {
        signal: {
          expandedText: routeExpansion.expandedText,
          id: signal.id,
          status: "PUBLISHED",
        },
      },
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json()).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          status: "PUBLISHED",
        },
      },
    });
  });

  it("hides completed draft publish from another frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const publishResponse = await testApp.inject({
      headers: {
        authorization: "Bearer other-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signal.id}/publish`,
    });
    const ownerResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(publishResponse.statusCode).toBe(404);
    expect(publishResponse.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
    expect(ownerResponse.json()).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          status: "DRAFT",
          visibility: "PREVIEW_OWNER",
        },
      },
    });
  });

  it("rejects publishing a signal before generation completes", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const storedSignal = signalStores.rows.find((row) => row.id === signal.id);

    if (storedSignal !== undefined) {
      storedSignal.generationStatus = "EXPANDING";
      storedSignal.status = "DRAFT";
    }

    const publishResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signal.id}/publish`,
    });

    expect(publishResponse.statusCode).toBe(409);
    expect(publishResponse.json()).toMatchObject({
      error: {
        code: "CONFLICT",
      },
    });
  });

  it("rejects publishing a signal that requires review", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp, "REVIEWING");
    const publishResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signal.id}/publish`,
    });

    expect(publishResponse.statusCode).toBe(409);
    expect(publishResponse.json()).toMatchObject({
      error: {
        code: "CONFLICT",
      },
    });
  });

  it("creates a continued signal under a visible parent signal", async () => {
    const testApp = await buildApp();
    app = testApp;

    const parentResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });
    const parentId = parentResponse.json().data.signal.id as string;
    const childResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        parentSignalId: parentId,
        seedText: "我想顺着这个问题，再写下一层自己的答案。",
      },
      url: "/api/signals",
    });

    expect(childResponse.statusCode).toBe(201);
    expect(childResponse.json()).toMatchObject({
      data: {
        signal: {
          generationStatus: "RECEIVED",
          parentSignalId: parentId,
          seedText: "我想顺着这个问题，再写下一层自己的答案。",
          status: "DRAFT",
          visibility: "GENERATION_OWNER",
        },
      },
    });
    await vi.waitFor(() => {
      const child = signalStores.rows.find((row) => row.id === childResponse.json().data.signal.id);

      expect(child).toMatchObject({
        generationStatus: "COMPLETED",
        parentSignalId: parentId,
        status: "DRAFT",
      });
    });
  });

  it("rejects a continued signal when the parent belongs to another frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const parentResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        seedText: "这段信号属于另一组 FM 频率。",
      },
      url: "/api/signals",
    });
    const parentId = parentResponse.json().data.signal.id as string;
    const childResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        parentSignalId: parentId,
        seedText: "我不该能接在别人的信号下面。",
      },
      url: "/api/signals",
    });

    expect(childResponse.statusCode).toBe(404);
    expect(childResponse.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });

  it("rejects direct signal creation without a frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("rejects invalid published signal input", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "短",
      },
      url: "/api/signals",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("rejects published signal input over 200 characters", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "种".repeat(201),
      },
      url: "/api/signals",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("does not register the legacy draft generation endpoint", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        rawInput: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals/generate",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "Not Found" });
  });

  it("returns not found when publishing a missing signal", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals/00000000-0000-4000-8000-000000000001/publish",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });

  it("exposes directly created signals in hall and detail endpoints", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp, "PUBLISHED");

    const hallResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/hall",
    });

    expect(hallResponse.statusCode).toBe(200);
    expect(hallResponse.json()).toMatchObject({
      data: {
        signals: [
          {
            id: signal.id,
            status: "PUBLISHED",
          },
        ],
      },
    });

    const detailResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          status: "PUBLISHED",
        },
      },
    });

    const randomResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/random",
    });
    const galaxyResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/galaxy",
    });

    expect(randomResponse.statusCode).toBe(200);
    expect(randomResponse.json()).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          status: "PUBLISHED",
        },
      },
    });
    expect(galaxyResponse.statusCode).toBe(200);
    expect(galaxyResponse.json()).toMatchObject({
      data: {
        points: [
          {
            id: signal.id,
            theme: "关系星云 · 被理解需求",
            position: {
              x: expect.any(Number),
              y: expect.any(Number),
              z: expect.any(Number),
            },
          },
        ],
      },
    });
  });

  it("exposes a generating signal only to its author", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const storedSignal = signalStores.rows.find((row) => row.id === signal.id);

    if (storedSignal !== undefined) {
      storedSignal.generationStatus = "EXPANDING";
      storedSignal.status = "DRAFT";
    }

    const ownerResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });
    const nonOwnerResponse = await testApp.inject({
      headers: {
        authorization: "Bearer other-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json()).toMatchObject({
      data: {
        signal: {
          generationStatus: "EXPANDING",
          id: signal.id,
          seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
          status: "DRAFT",
          visibility: "GENERATION_OWNER",
        },
      },
    });
    expect(ownerResponse.json().data.signal).not.toHaveProperty("expandedText");
    expect(nonOwnerResponse.statusCode).toBe(404);
  });

  it("hides published rows that have not completed generation from public surfaces", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp);
    const storedSignal = signalStores.rows.find((row) => row.id === signal.id);

    expect(storedSignal).toBeDefined();

    if (storedSignal !== undefined) {
      storedSignal.generationStatus = "MATCHING";
      storedSignal.status = "PUBLISHED";
    }

    const hallResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/hall",
    });
    const detailResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });
    const randomResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/random",
    });
    const galaxyResponse = await testApp.inject({
      method: "GET",
      url: "/api/signals/galaxy",
    });
    const matchesResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}/matches`,
    });
    const audioResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}/audio`,
    });
    const resonanceResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signal.id}/resonance`,
    });
    const saveResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      url: `/api/signals/${signal.id}/save`,
    });
    const echoResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        content: "这条异常信号不该能收到回应。",
      },
      url: `/api/signals/${signal.id}/echoes`,
    });

    expect(hallResponse.statusCode).toBe(200);
    expect(hallResponse.json().data.signals).toEqual([]);
    expect(detailResponse.statusCode).toBe(404);
    expect(randomResponse.statusCode).toBe(404);
    expect(galaxyResponse.statusCode).toBe(200);
    expect(galaxyResponse.json().data.points).toEqual([]);
    expect(matchesResponse.statusCode).toBe(404);
    expect(audioResponse.statusCode).toBe(404);
    expect(resonanceResponse.statusCode).toBe(404);
    expect(saveResponse.statusCode).toBe(404);
    expect(echoResponse.statusCode).toBe(404);
  });

  it("exposes a reviewing signal result to its author", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp, "REVIEWING");

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
          status: "REVIEWING",
        },
      },
    });
  });

  it("returns a restricted reviewing signal result to non-authors", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp, "REVIEWING");

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer other-token",
      },
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });
    const responseBody = response.json();

    expect(response.statusCode).toBe(200);
    expect(responseBody).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          status: "REVIEWING",
          visibility: "REVIEW_RESTRICTED",
        },
      },
    });
    expect(responseBody.data.signal).not.toHaveProperty("seedText");
    expect(responseBody.data.signal).not.toHaveProperty("expandedText");
  });

  it("returns a restricted reviewing signal result without a session", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signal = await createSignal(testApp, "REVIEWING");

    const response = await testApp.inject({
      method: "GET",
      url: `/api/signals/${signal.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        signal: {
          id: signal.id,
          status: "REVIEWING",
          visibility: "REVIEW_RESTRICTED",
        },
      },
    });
  });

  it("filters galaxy points by fixed band query", async () => {
    const testApp = await buildApp();
    app = testApp;

    const firstDraft = await createSignal(testApp, "PUBLISHED");
    const secondDraft = await createSignal(testApp, "PUBLISHED");
    const secondSignal = signalStores.rows.find((row) => row.id === secondDraft.id);

    if (secondSignal !== undefined) {
      secondSignal.status = "PUBLISHED";
      secondSignal.fingerprintJson = {
        ...secondSignal.fingerprintJson,
        primaryBand: "meaning_deep_space",
        subFeeling: "effort_doubt",
        displayText: "意义深空 · 努力怀疑",
        resonanceKeywords: ["忙碌", "空转", "自我价值"],
        tags: ["希望"],
        theme: "希望",
      };
      secondSignal.primaryBand = "meaning_deep_space";
      secondSignal.subFeeling = "effort_doubt";
      secondSignal.coreNeed = "确认努力是否值得";
      secondSignal.emotionTone = "清醒疲惫";
      secondSignal.innerConflict = "想继续努力，但怀疑努力是否通向想要的生活";
      secondSignal.resonanceKeywords = ["忙碌", "空转", "自我价值"];
    }

    const response = await testApp.inject({
      method: "GET",
      url: "/api/signals/galaxy?band=meaning_deep_space",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        points: [
          {
            id: secondDraft.id,
            theme: "意义深空 · 努力怀疑",
          },
        ],
        themeOptions: ["意义深空", "关系星云"],
      },
    });
    expect(response.json().data.points).not.toContainEqual(
      expect.objectContaining({ id: firstDraft.id }),
    );
  });

  it("returns signal detail when stored fingerprint JSON is legacy and partial", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "PUBLISHED");
    const signal = signalStores.rows.find((row) => row.id === draft.id);

    expect(signal).toBeDefined();

    if (signal !== undefined) {
      signal.seedText = "我希望有人理解今天没有说出口的那句话。";
      signal.expandedText = "夜里把想被理解的念头收起来，放在桌角等一会儿。";
      signal.fingerprintJson = {
        hiddenNeed: "希望被理解",
        narrativeConflict: "想靠近别人，又担心打扰别人",
        tags: ["孤独", "夜晚"],
        theme: "关系",
        title: "旧信号",
      } as unknown as SignalFingerprint;
      signal.coreNeed = null;
      signal.emotionTone = null;
      signal.innerConflict = null;
      signal.primaryBand = null;
      signal.resonanceKeywords = null;
      signal.subFeeling = null;
    }

    const response = await testApp.inject({
      method: "GET",
      url: `/api/signals/${draft.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        signal: {
          fingerprint: {
            coreNeed: "希望被理解",
            displayText: "关系星云 · 被理解需求",
            energy: 0.5,
            emotionTone: "安静复杂",
            frequency: "FM-27.51",
            hiddenNeed: "希望被理解",
            innerConflict: "想靠近别人，又担心打扰别人",
            narrativeConflict: "想靠近别人，又担心打扰别人",
            openness: 0.5,
            primaryBand: "relationship_nebula",
            primaryEmotion: "安静复杂",
            resonanceKeywords: ["孤独", "夜晚"],
            riskLevel: "LOW",
            secondaryEmotions: [],
            signalType: "relationship_nebula",
            subFeeling: "need_to_be_understood",
            tags: ["孤独", "夜晚"],
            theme: "关系",
            title: "旧信号",
          },
          frequencyProfile: {
            coreNeed: "希望被理解",
            displayText: "关系星云 · 被理解需求",
            primaryBand: "relationship_nebula",
            resonanceKeywords: ["孤独", "夜晚"],
            subFeeling: "need_to_be_understood",
          },
          id: draft.id,
          status: "PUBLISHED",
        },
      },
    });
  });

  it("queries audio without starting TTS and fails explicit audio request when TTS is unconfigured", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "PUBLISHED");

    const audioResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${draft.id}/audio`,
    });
    const requestAudioResponse = await testApp.inject({
      method: "POST",
      url: `/api/signals/${draft.id}/audio`,
    });
    const downloadResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${draft.id}/audio/main`,
    });

    expect(audioResponse.statusCode).toBe(200);
    expect(audioResponse.json()).toMatchObject({
      data: {
        audio: {
          audioStatus: "NOT_REQUESTED",
          signalId: draft.id,
        },
      },
    });
    expect(requestAudioResponse.statusCode).toBe(200);
    expect(requestAudioResponse.json()).toMatchObject({
      data: {
        audio: {
          audioStatus: "FAILED",
          signalId: draft.id,
        },
      },
    });
    expect(downloadResponse.statusCode).toBe(409);
  });

  it("streams generated signal audio when status is ready", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "PUBLISHED");
    signalStores.rows[0].audioStatus = "READY";
    signalStores.rows[0].audioStorageKey = `${draft.id}.mp3`;
    signalStores.rows[0].audioStorageKeyLeft = `${draft.id}.mp3`;
    signalStores.rows[0].audioStorageKeyRight = `${draft.id}.mp3`;
    signalStores.rows[0].audioUrl = `/api/signals/${draft.id}/audio/main`;
    signalStores.rows[0].audioUrlLeft = `/api/signals/${draft.id}/audio/main`;
    signalStores.rows[0].audioUrlRight = `/api/signals/${draft.id}/audio/main`;

    const response = await testApp.inject({
      method: "GET",
      url: `/api/signals/${draft.id}/audio/main`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/mpeg");
  });

  it("creates an echo on a published signal", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "PUBLISHED");

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        content: "我也在这个频率附近。",
      },
      url: `/api/signals/${draft.id}/echoes`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        echo: {
          authorFreqCode: "FM-27.51",
          content: "我也在这个频率附近。",
          signalId: draft.id,
          status: "PUBLISHED",
        },
      },
    });

    const echoesResponse = await testApp.inject({
      method: "GET",
      url: `/api/signals/${draft.id}/echoes`,
    });

    expect(echoesResponse.statusCode).toBe(200);
    expect(echoesResponse.json()).toMatchObject({
      data: {
        echoes: [
          {
            authorFreqCode: "FM-27.51",
            content: "我也在这个频率附近。",
            signalId: draft.id,
          },
        ],
      },
    });
  });

  it("toggles signal resonance idempotently for the current frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "PUBLISHED");

    const firstResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${draft.id}/resonance`,
    });
    const secondResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${draft.id}/resonance`,
    });
    const deleteResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "DELETE",
      payload: {},
      url: `/api/signals/${draft.id}/resonance`,
    });
    const secondDeleteResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "DELETE",
      payload: {},
      url: `/api/signals/${draft.id}/resonance`,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().data.resonance).toMatchObject({
      hasResonated: true,
      resonanceCount: 1,
    });
    expect(secondResponse.json().data.resonance).toMatchObject({
      hasResonated: true,
      resonanceCount: 1,
    });
    expect(deleteResponse.json().data.resonance).toMatchObject({
      hasResonated: false,
      resonanceCount: 0,
    });
    expect(secondDeleteResponse.json().data.resonance).toMatchObject({
      hasResonated: false,
      resonanceCount: 0,
    });
  });

  it("accepts the resonate alias for signal resonance", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "PUBLISHED");

    const response = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${draft.id}/resonate`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resonance).toMatchObject({
      hasResonated: true,
      resonanceCount: 1,
    });
  });

  it("saves and unsaves a published signal privately for the current frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const signalResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        seedText: "这段信号属于另一组 FM 频率，但可以被当前频率收藏。",
      },
      url: "/api/signals",
    });
    const signalId = signalResponse.json().data.signal.id as string;
    await waitForSignalCompleted(signalId);
    setSignalStatus(signalId, "PUBLISHED");

    const saveResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      url: `/api/signals/${signalId}/save`,
    });
    const detailResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: `/api/signals/${signalId}`,
    });
    const savedListResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: "/api/me/saves",
    });
    const unsaveResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "DELETE",
      url: `/api/signals/${signalId}/save`,
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toMatchObject({
      data: {
        save: {
          hasSaved: true,
        },
      },
    });
    expect(detailResponse.json()).toMatchObject({
      data: {
        signal: {
          hasSaved: true,
          id: signalId,
        },
      },
    });
    expect(savedListResponse.statusCode).toBe(200);
    expect(savedListResponse.json()).toMatchObject({
      data: {
        signals: [
          {
            id: signalId,
            savedAt: "2026-05-10T12:04:00.000Z",
            theme: "关系星云 · 被理解需求",
          },
        ],
      },
    });
    expect(unsaveResponse.json()).toMatchObject({
      data: {
        save: {
          hasSaved: false,
        },
      },
    });
  });

  it("rejects signal saving without a frequency session", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp);

    const response = await testApp.inject({
      method: "POST",
      url: `/api/signals/${draft.id}/save`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("rejects signal resonance without a frequency", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp);

    const response = await testApp.inject({
      method: "POST",
      payload: {},
      url: `/api/signals/${draft.id}/resonance`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("returns not found for hidden signal detail", async () => {
    const testApp = await buildApp();
    app = testApp;

    const draft = await createSignal(testApp, "HIDDEN");
    const response = await testApp.inject({
      method: "GET",
      url: `/api/signals/${draft.id}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });

  it("returns current frequency signals and echo summary", async () => {
    const testApp = await buildApp();
    app = testApp;

    const firstResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });
    const firstId = firstResponse.json().data.signal.id as string;
    await waitForSignalCompleted(firstId);
    const secondResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        parentSignalId: firstId,
        seedText: "我在另一段夜路里，继续等一个安静的答案。",
      },
      url: "/api/signals",
    });
    const otherSignal = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        seedText: "这段信号属于另一组 FM 频率，不该进当前页面。",
      },
      url: "/api/signals",
    });
    const otherId = otherSignal.json().data.signal.id;
    await waitForSignalCompleted(secondResponse.json().data.signal.id);
    await waitForSignalCompleted(otherId);

    signalStores.rows.find((row) => row.id === firstId)!.resonanceCount = 3;
    signalStores.rows.find((row) => row.id === otherId)!.resonanceCount = 9;

    const signalsResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: "/api/me/signals",
    });
    const summaryResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: "/api/me/echo-summary",
    });

    expect(signalsResponse.statusCode).toBe(200);
    expect(signalsResponse.json()).toMatchObject({
      data: {
        signals: [
          {
            id: firstId,
            resonanceCount: 3,
            seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
          },
          {
            id: secondResponse.json().data.signal.id,
            parentSignalId: firstId,
            resonanceCount: 0,
          },
        ],
        totalResonanceCount: 3,
      },
    });
    expect(signalsResponse.json().data.signals).toHaveLength(2);
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toMatchObject({
      data: {
        summary: {
          frequencyId: "00000000-0000-4000-8000-000000000301",
          newResonanceCount: 0,
          topSignal: {
            id: firstId,
            resonanceCount: 3,
          },
          totalResonanceCount: 3,
        },
      },
    });
  });

  it("keeps continued signals readable when the parent is deleted", async () => {
    const testApp = await buildApp();
    app = testApp;

    const parentResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });
    const parentId = parentResponse.json().data.signal.id as string;
    const childResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        parentSignalId: parentId,
        seedText: "我沿着那个问题继续往下写一层。",
      },
      url: "/api/signals",
    });
    const childId = childResponse.json().data.signal.id as string;

    signalStores.rows.find((row) => row.id === parentId)!.status = "DELETED";

    const signalsResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: "/api/me/signals",
    });

    expect(signalsResponse.statusCode).toBe(200);
    expect(signalsResponse.json()).toMatchObject({
      data: {
        signals: [
          {
            id: childId,
            parentSignalId: parentId,
            seedText: "我沿着那个问题继续往下写一层。",
          },
        ],
      },
    });
    expect(signalsResponse.json().data.signals).toHaveLength(1);
  });

  it("random tuning avoids the current frequency when another signal exists", async () => {
    const testApp = await buildApp();
    app = testApp;

    const ownResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });
    const otherResponse = await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        seedText: "这段信号属于另一组 FM 频率，会被随机调频收到。",
      },
      url: "/api/signals",
    });
    await waitForSignalCompleted(ownResponse.json().data.signal.id);
    await waitForSignalCompleted(otherResponse.json().data.signal.id);
    setSignalStatus(ownResponse.json().data.signal.id, "PUBLISHED");
    setSignalStatus(otherResponse.json().data.signal.id, "PUBLISHED");

    const randomResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: "/api/signals/random",
    });

    expect(randomResponse.statusCode).toBe(200);
    expect(randomResponse.json().data.signal).toMatchObject({
      id: otherResponse.json().data.signal.id,
    });
    expect(randomResponse.json().data.signal.id).not.toBe(ownResponse.json().data.signal.id);
  });

  it("counts new resonances since the last seen watermark and marks them seen", async () => {
    const testApp = await buildApp();
    app = testApp;

    signalStores.lastSeenAtByFrequencyId.set(
      "00000000-0000-4000-8000-000000000301",
      new Date("2026-05-10T00:00:00.000Z"),
    );

    const firstResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      url: "/api/signals",
    });
    const signalId = firstResponse.json().data.signal.id as string;
    await waitForSignalCompleted(signalId);
    setSignalStatus(signalId, "PUBLISHED");

    await testApp.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signalId}/resonance`,
    });
    await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      payload: {},
      url: `/api/signals/${signalId}/resonate`,
    });

    const summaryResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "GET",
      url: "/api/me/echo-summary",
    });
    const seenResponse = await testApp.inject({
      headers: {
        authorization: "Bearer active-token",
      },
      method: "POST",
      url: "/api/me/echo-summary/seen",
    });

    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toMatchObject({
      data: {
        summary: {
          frequencyId: "00000000-0000-4000-8000-000000000301",
          newResonanceCount: 2,
          since: "2026-05-10T00:00:00.000Z",
          topSignal: {
            id: signalId,
            resonanceCount: 2,
          },
          totalResonanceCount: 2,
        },
      },
    });
    expect(seenResponse.statusCode).toBe(200);
    expect(signalStores.lastSeenAtByFrequencyId.get(
      "00000000-0000-4000-8000-000000000301",
    )).toBeInstanceOf(Date);
  });
});
