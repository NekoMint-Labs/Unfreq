import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import {
  analyzeSignalIntentWithFallback,
  classifySignalSeedWithFallback,
  generateSignalExpansionWithFallback,
  generateSignalContentWithFallback,
  generateSignalFingerprintWithFallback,
  generateSignalMaterial,
  reviewSignalExpansionWithFallback,
  scoreSignalQualityWithFallback,
} from "../ai/service.js";
import {
  generateEmbedding,
  isEmbeddingProviderConfigured,
} from "../ai/embedding.js";
import type { CreateSignalInput, SignalFingerprint, SignalProgram, SignalRecord } from "./types.js";
import {
  createSignalDraft,
  listPublishedGalaxySignals,
  listPublishedGalaxyThemes,
  listSignalsByRawInput,
  listPublishedSemanticSignalMatchCandidates,
  listPublishedSignalMatchCandidates,
  findVisibleSignalForFrequency,
  writeSignalEmbeddingIfMissing,
  writeSignalGalaxyPositionIfMissing,
} from "./repository.js";
import {
  createPublishedSignal,
  generateAiSignals,
  getSignalGalaxy,
  seedSignalLibrary,
} from "./service.js";
import type { AuthenticatedFrequency } from "../auth/types.js";

const signalStore = vi.hoisted(() => {
  return {
    createdInputs: [] as CreateSignalInput[],
    matchCandidates: [] as SignalRecord[],
  };
});

const defaultFingerprint: SignalFingerprint = {
  coreNeed: "希望被理解",
  displayText: "关系星云 · 被理解需求",
  energy: 0.62,
  emotionTone: "安静孤独",
  frequency: "SIG-TEST",
  hiddenNeed: "希望被理解",
  innerConflict: "想靠近别人，又担心打扰别人",
  narrativeConflict: "想靠近别人，又担心打扰别人",
  openness: 0.51,
  primaryBand: "relationship_nebula",
  primaryEmotion: "孤独",
  resonanceKeywords: ["孤独", "夜晚"],
  riskLevel: "LOW",
  secondaryEmotions: ["等待"],
  signalType: "relationship_nebula",
  subFeeling: "need_to_be_understood",
  tags: ["孤独", "夜晚"],
  theme: "关系星云",
  title: "夜里的信号",
};

const defaultProgram: SignalProgram = {
  bridgeNarration: "两段信号在夜里短暂停靠。",
  closingQuestion: "你愿意继续留下这段同频吗？",
  hostIntro: "这里是 SIG-TEST，收到一段新的匿名信号。",
  leftSignalSummary: "今晚想把这段匿名信号留在这里。",
  programTitle: "夜里的信号 / 同频试播",
  rightSignalSummary: "有人也在相近的夜里等待。",
  shareQuote: "我在 SIG-TEST 留下了一段信号。",
};

const defaultExpansion = {
  expandedText:
    "屏幕暗下去的时候，房间里只剩空调细小的声响，我把杯沿转了一圈，又停住。今晚想把这段匿名信号留在这里这件事没有被我说得很重，却一直在旁边。那一点停顿比解释更早露出来。",
  followUpQuestion: "你最近把哪句话留在了原地？",
};

const defaultClassification = {
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

const defaultExpansionReview = {
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
};

const testFrequency: AuthenticatedFrequency = {
  createdAt: "2026-05-10T00:00:00.000Z",
  freqCode: "FM-27.51",
  id: "00000000-0000-4000-8000-000000000301",
  role: "USER",
  status: "ACTIVE",
};

vi.mock("../ai/service.js", () => {
  return {
    analyzeSignalIntentWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: defaultClassification,
        reviewId: "00000000-0000-4000-8000-000000000912",
      });
    }),
    classifySignalSeedWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: defaultClassification,
        reviewId: "00000000-0000-4000-8000-000000000907",
      });
    }),
    generateSignalExpansionWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: defaultExpansion,
        reviewId: "00000000-0000-4000-8000-000000000908",
      });
    }),
    generateSignalMaterial: vi.fn(() => {
      return Promise.resolve({
        result: {
          classification: defaultClassification,
          expansion: defaultExpansion,
          fingerprint: defaultFingerprint,
        },
        reviewId: "00000000-0000-4000-8000-000000000913",
      });
    }),
    generateSignalFingerprintWithFallback: vi.fn(() => {
      return Promise.resolve({
        result: defaultFingerprint,
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
        result: defaultExpansionReview,
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

vi.mock("../ai/embedding.js", () => {
  return {
    generateEmbedding: vi.fn(),
    isEmbeddingProviderConfigured: vi.fn(() => Promise.resolve(false)),
    signalEmbeddingDimensions: 1024,
  };
});

vi.mock("../ai/reranker.js", () => {
  return {
    isRerankerProviderConfigured: vi.fn(() => Promise.resolve(false)),
    rerankCandidates: vi.fn(),
  };
});

vi.mock("./repository.js", () => {
  return {
    SignalNotFoundForInteraction: class SignalNotFoundForInteraction extends Error {},
    createSignalDraft: vi.fn((input: CreateSignalInput) => {
      signalStore.createdInputs.push(input);

      const now = new Date("2026-05-10T12:00:00.000Z");
      const record: SignalRecord = {
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
        id: "00000000-0000-4000-8000-000000000001",
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

      return Promise.resolve(record);
    }),
    completeSignalGeneration: vi.fn(() => Promise.resolve(undefined)),
    createSignalEcho: vi.fn(),
    findPublishedSignalById: vi.fn(),
    findSignalResultById: vi.fn(),
    findVisibleSignalForFrequency: vi.fn(),
    listSignalsByRawInput: vi.fn(() => Promise.resolve([])),
    listPublishedSignalMatchCandidates: vi.fn(() => {
      return Promise.resolve(signalStore.matchCandidates);
    }),
    listPublishedSemanticSignalMatchCandidates: vi.fn(() => {
      return Promise.resolve([]);
    }),
    listPublishedSignals: vi.fn(),
    listPublishedGalaxySignals: vi.fn(),
    listPublishedGalaxyThemes: vi.fn(() => Promise.resolve(["孤独", "希望"])),
    listSignalsForAuthor: vi.fn(() => Promise.resolve([])),
    markSignalAudioFailed: vi.fn(),
    markSignalAudioPending: vi.fn(),
    markSignalAudioReady: vi.fn(),
    updateSignalGenerationStatus: vi.fn(() => Promise.resolve(undefined)),
    writeSignalEmbeddingIfMissing: vi.fn(() => {
      return Promise.resolve(true);
    }),
    writeSignalGalaxyPositionIfMissing: vi.fn(() => {
      return Promise.resolve(true);
    }),
  };
});

function buildCandidate(params: {
  id: string;
  primaryEmotion: string;
  rawInput?: string;
  signalType: string;
  tags: string[];
  title: string;
}): SignalRecord {
  const now = new Date("2026-05-10T11:00:00.000Z");
  const primaryBand = params.signalType === "pressure-wave"
    ? "emotional_undercurrent"
    : params.signalType === "quiet-orbit"
      ? "time_ring"
      : "relationship_nebula";
  const subFeeling = primaryBand === "emotional_undercurrent"
    ? "anxiety"
    : primaryBand === "time_ring"
      ? "nostalgia"
      : "need_to_be_understood";

  return {
    authorFreqCode: "FM-10.01",
    authorId: "00000000-0000-4000-8000-000000000101",
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
    expandedText: params.rawInput ?? params.title,
    fingerprintJson: {
      ...defaultFingerprint,
      primaryEmotion: params.primaryEmotion,
      signalType: params.signalType,
      tags: params.tags,
      title: params.title,
    },
    followUpQuestion: defaultProgram.closingQuestion,
    frequencyId: null,
    galaxyPosition: null,
    generationError: null,
    generationStatus: "COMPLETED",
    guestKey: null,
    id: params.id,
    coreNeed: "希望被理解",
    emotionTone: "安静孤独",
    innerConflict: "想靠近别人，又担心打扰别人",
    matchSignalId: null,
    parentSignalId: null,
    primaryBand,
    programJson: defaultProgram,
    qualityReason: null,
    qualityScore: null,
    rawInput: params.rawInput ?? params.title,
    resonanceCount: 0,
    resonanceKeywords: params.tags.slice(0, 3),
    seedText: params.rawInput ?? params.title,
    source: "human",
    status: "PUBLISHED",
    subFeeling,
    isKept: false,
    updatedAt: now,
  };
}

beforeEach(() => {
  signalStore.createdInputs = [];
  signalStore.matchCandidates = [];
  vi.mocked(analyzeSignalIntentWithFallback).mockReset();
  vi.mocked(classifySignalSeedWithFallback).mockReset();
  vi.mocked(generateSignalMaterial).mockReset();
  vi.mocked(generateSignalFingerprintWithFallback).mockReset();
  vi.mocked(generateSignalExpansionWithFallback).mockReset();
  vi.mocked(generateSignalContentWithFallback).mockReset();
  vi.mocked(reviewSignalExpansionWithFallback).mockReset();
  vi.mocked(scoreSignalQualityWithFallback).mockReset();
  vi.mocked(generateEmbedding).mockReset();
  vi.mocked(isEmbeddingProviderConfigured).mockReset();
  vi.mocked(createSignalDraft).mockClear();
  vi.mocked(findVisibleSignalForFrequency).mockClear();
  vi.mocked(listPublishedGalaxyThemes).mockClear();
  vi.mocked(listPublishedSemanticSignalMatchCandidates).mockClear();
  vi.mocked(listSignalsByRawInput).mockClear();
  vi.mocked(listPublishedSignalMatchCandidates).mockClear();
  vi.mocked(writeSignalEmbeddingIfMissing).mockClear();
  vi.mocked(analyzeSignalIntentWithFallback).mockResolvedValue({
    result: defaultClassification,
    reviewId: "00000000-0000-4000-8000-000000000912",
  });
  vi.mocked(classifySignalSeedWithFallback).mockResolvedValue({
    result: defaultClassification,
    reviewId: "00000000-0000-4000-8000-000000000907",
  });
  vi.mocked(generateSignalMaterial).mockResolvedValue({
    result: {
      classification: defaultClassification,
      expansion: defaultExpansion,
      fingerprint: defaultFingerprint,
    },
    reviewId: "00000000-0000-4000-8000-000000000913",
  });
  vi.mocked(generateSignalFingerprintWithFallback).mockResolvedValue({
    result: defaultFingerprint,
    reviewId: "00000000-0000-4000-8000-000000000901",
  });
  vi.mocked(generateSignalExpansionWithFallback).mockResolvedValue({
    result: defaultExpansion,
    reviewId: "00000000-0000-4000-8000-000000000908",
  });
  vi.mocked(reviewSignalExpansionWithFallback).mockResolvedValue({
    result: defaultExpansionReview,
    reviewId: "00000000-0000-4000-8000-000000000909",
  });
  vi.mocked(generateSignalContentWithFallback).mockResolvedValue({
    result: {
      rawInput: "我在末班地铁里反复想起今天的失误，想解释，又怕别人觉得我只是在找借口。",
    },
    reviewId: "00000000-0000-4000-8000-000000000905",
  });
  vi.mocked(scoreSignalQualityWithFallback).mockResolvedValue({
    result: {
      reason: "内容具体自然。",
      score: 4,
    },
    reviewId: "00000000-0000-4000-8000-000000000906",
  });
  vi.mocked(isEmbeddingProviderConfigured).mockResolvedValue(false);
  vi.mocked(findVisibleSignalForFrequency).mockResolvedValue(undefined);
});

describe("signal service AI generation", () => {
  it("creates a published signal with validated fingerprint and minimal program metadata", async () => {
    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal).toMatchObject({
      fingerprint: {
        frequency: "SIG-TEST",
        riskLevel: "LOW",
      },
      matches: expect.arrayContaining([
        expect.objectContaining({
          source: "SEEDED",
        }),
      ]),
      program: {
        hostIntro: "来自 SIG-TEST 的一条生活信号。",
        programTitle: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      status: "PUBLISHED",
    });
    expect(createSignalDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        expandedText: defaultExpansion.expandedText,
        frequencyId: testFrequency.id,
        followUpQuestion: defaultExpansion.followUpQuestion,
        rawInput: "今晚想把这段匿名信号留在这里，等一个同频的人。",
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
        status: "PUBLISHED",
      }),
    );
    expect(writeSignalGalaxyPositionIfMissing).toHaveBeenCalledWith({
      id: signal.id,
      position: {
        x: expect.any(Number),
        y: expect.any(Number),
        z: expect.any(Number),
      },
    });
    expect(generateSignalMaterial).toHaveBeenCalledWith({
      content: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });
    expect(generateSignalFingerprintWithFallback).not.toHaveBeenCalled();
    expect(generateSignalExpansionWithFallback).not.toHaveBeenCalled();
    expect(reviewSignalExpansionWithFallback).toHaveBeenCalledWith({
      classification: defaultClassification,
      expandedText: defaultExpansion.expandedText,
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });
  });

  it("reviews and rewrites combined material expansion before persistence", async () => {
    const rejectedExpansion = {
      expandedText:
        "都来打垒球！像一句被放进空房间里的口号，窗外有光慢慢落下，空气里只剩下轻轻的停顿，好像所有人都在等待一个答案。",
      followUpQuestion: "谁先动起来？",
    };
    const rewrittenExpansion = {
      expandedText:
        "有人把球棒从器材袋里抽出来，鞋底踩过土面，带起一点灰。都来打垒球！这句话一落下，场边先热起来，笑声绕着本垒滚了一圈，球还没飞出去，大家已经开始往前跑。",
      followUpQuestion: "谁会先跑起来？",
    };
    vi.mocked(generateSignalMaterial).mockResolvedValue({
      result: {
        classification: {
          ...defaultClassification,
          energy: "high",
          expansionMode: "light_scene",
          intendedFocus: "把邀约和场上动起来的热闹写出来",
          keywords: ["垒球", "人群", "跑"],
          mood: "lively",
          preserve: ["垒球"],
          sceneHint: "围绕场地、身体动作、节奏和人群声音展开",
          shouldBeNegative: false,
          type: "sports",
          userAct: "invite",
        },
        expansion: rejectedExpansion,
        fingerprint: defaultFingerprint,
      },
      reviewId: "00000000-0000-4000-8000-000000000913",
    });
    vi.mocked(reviewSignalExpansionWithFallback)
      .mockResolvedValueOnce({
        result: {
          hasConcreteObjects: false,
          hasSensoryDetails: false,
          isForcedNegative: true,
          isGenericLiteraryTemplate: true,
          matchesSeedType: false,
          pass: false,
          preservesOriginalDirection: true,
          problems: ["强行悲伤", "模板化"],
          rewriteInstruction: "按 sports 类型重写，写人群和动作，不要悲伤。",
          score: 3,
        },
        reviewId: "00000000-0000-4000-8000-000000000910",
      })
      .mockResolvedValueOnce({
        result: defaultExpansionReview,
        reviewId: "00000000-0000-4000-8000-000000000911",
      });
    vi.mocked(generateSignalExpansionWithFallback).mockResolvedValue({
      result: rewrittenExpansion,
      reviewId: "00000000-0000-4000-8000-000000000909",
    });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "都来打垒球！",
    });

    expect(signal.expandedText).toBe(rewrittenExpansion.expandedText);
    expect(generateSignalFingerprintWithFallback).not.toHaveBeenCalled();
    expect(generateSignalExpansionWithFallback).toHaveBeenCalledTimes(1);
    expect(generateSignalExpansionWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        rewriteInstruction: "按 sports 类型重写，写人群和动作，不要悲伤。",
        seedText: "都来打垒球！",
      }),
      undefined,
      { skipDirectionReview: true },
    );
    expect(reviewSignalExpansionWithFallback).toHaveBeenCalledTimes(2);
    expect(reviewSignalExpansionWithFallback).toHaveBeenNthCalledWith(1, {
      classification: expect.objectContaining({
        type: "sports",
      }),
      expandedText: rejectedExpansion.expandedText,
      seedText: "都来打垒球！",
    });
    expect(reviewSignalExpansionWithFallback).toHaveBeenNthCalledWith(2, {
      classification: expect.objectContaining({
        type: "sports",
      }),
      expandedText: rewrittenExpansion.expandedText,
      seedText: "都来打垒球！",
    });
    expect(signalStore.createdInputs[0]).toMatchObject({
      expandedText: rewrittenExpansion.expandedText,
      followUpQuestion: rewrittenExpansion.followUpQuestion,
      qualityScore: 4,
    });
  });

  it("creates a published homepage signal without the draft publish path", async () => {
    vi.mocked(isEmbeddingProviderConfigured).mockResolvedValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      dimensions: 1024,
      embedding: Array.from({ length: 1024 }, () => 0.2),
      model: "text-embedding-v3",
      provider: "dashscope",
      version: "v1",
    });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal.status).toBe("PUBLISHED");
    expect(signalStore.createdInputs[0]).toMatchObject({
      rawInput: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      status: "PUBLISHED",
    });
    await vi.waitFor(() => {
      expect(writeSignalEmbeddingIfMissing).toHaveBeenCalledTimes(1);
    });
  });

  it("creates a reviewing homepage signal for high-risk content without publishing", async () => {
    vi.mocked(generateSignalMaterial).mockResolvedValue({
      result: {
        classification: defaultClassification,
        expansion: defaultExpansion,
        fingerprint: {
          ...defaultFingerprint,
          riskLevel: "HIGH",
        },
      },
      reviewId: "00000000-0000-4000-8000-000000000913",
    });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "这是一段需要人工复核的高风险信号。",
    });

    expect(signal.status).toBe("REVIEWING");
    expect(signalStore.createdInputs[0]?.status).toBe("REVIEWING");
  });

  it("falls back to the split signal creation chain when combined material fails", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider returned invalid JSON.", {
        boundary: "provider_call",
        kind: "invalid_json",
        type: "signal-material",
      }),
    );

    const signal = await createPublishedSignal(
      testFrequency,
      {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      logger,
    );

    expect(signal.expandedText).toBe(defaultExpansion.expandedText);
    expect(generateSignalFingerprintWithFallback).toHaveBeenCalledTimes(1);
    expect(generateSignalExpansionWithFallback).toHaveBeenCalledTimes(1);
    expect(reviewSignalExpansionWithFallback).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        action: "signal.material.failed",
        failureBoundary: "provider_call",
        failureKind: "invalid_json",
        failureType: "signal-material",
        reason: "AI_UNAVAILABLE",
        targetType: "SIGNAL",
      },
      "signal material generation failed",
    );
  });

  it("links a continued signal to a visible parent from the same frequency", async () => {
    const parent = buildCandidate({
      id: "00000000-0000-4000-8000-000000000901",
      primaryEmotion: "孤独",
      signalType: "life-fragment",
      tags: ["孤独"],
      title: "父级信号",
    });
    vi.mocked(findVisibleSignalForFrequency).mockResolvedValue(parent);

    await createPublishedSignal(
      testFrequency,
      {
        parentSignalId: parent.id,
        seedText: "我想沿着这个问题继续往下想一层。",
      },
    );

    expect(findVisibleSignalForFrequency).toHaveBeenCalledWith({
      frequencyId: "00000000-0000-4000-8000-000000000301",
      id: parent.id,
    });
    expect(createSignalDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSignalId: parent.id,
      }),
    );
  });

  it("rejects a continued signal when the parent is not visible to the frequency", async () => {
    await expect(
      createPublishedSignal(
        testFrequency,
        {
          parentSignalId: "00000000-0000-4000-8000-000000000902",
          seedText: "我想沿着这个问题继续往下想一层。",
        },
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(createSignalDraft).not.toHaveBeenCalled();
  });

  it("keeps signal readable when embedding is unavailable and audio has not been requested", async () => {
    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal).toMatchObject({
      audioStatus: "NOT_REQUESTED",
      expandedText: defaultExpansion.expandedText,
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(writeSignalEmbeddingIfMissing).not.toHaveBeenCalled();
  });

  it("ranks same-band and same-feeling matches as stable Top 3", async () => {
    signalStore.matchCandidates = [
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000203",
        primaryEmotion: "孤独",
        signalType: "life-fragment",
        tags: ["夜晚"],
        title: "第三段信号",
      }),
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000201",
        primaryEmotion: "孤独",
        signalType: "life-fragment",
        tags: ["孤独", "夜晚"],
        title: "第一段信号",
      }),
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000202",
        primaryEmotion: "压力",
        signalType: "pressure-wave",
        tags: ["压力"],
        title: "低分信号",
      }),
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000204",
        primaryEmotion: "孤独",
        signalType: "life-fragment",
        tags: ["孤独"],
        title: "第二段信号",
      }),
    ];

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal.matches.map((match) => match.id)).toEqual([
      "00000000-0000-4000-8000-000000000201",
      "00000000-0000-4000-8000-000000000203",
      "00000000-0000-4000-8000-000000000204",
    ]);
    expect(signalStore.createdInputs[0]?.matchSignalId).toBe(
      "00000000-0000-4000-8000-000000000201",
    );
  });

  it("uses semantic Top 3 matches before keyword matches when embeddings are available", async () => {
    const embedding = Array.from({ length: 1024 }, (_, index) => index / 1024);
    vi.mocked(isEmbeddingProviderConfigured).mockResolvedValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      dimensions: 1024,
      embedding,
      model: "text-embedding-v3",
      provider: "dashscope",
      version: "v1",
    });
    vi.mocked(listPublishedSemanticSignalMatchCandidates).mockResolvedValue([
      {
        ...buildCandidate({
          id: "00000000-0000-4000-8000-000000000302",
          primaryEmotion: "孤独",
          signalType: "life-fragment",
          tags: ["夜晚"],
          title: "最近的语义信号",
        }),
        distance: 0.05,
      },
      {
        ...buildCandidate({
          id: "00000000-0000-4000-8000-000000000303",
          primaryEmotion: "等待",
          signalType: "life-fragment",
          tags: ["等待"],
          title: "第二段语义信号",
        }),
        distance: 0.2,
      },
      {
        ...buildCandidate({
          id: "00000000-0000-4000-8000-000000000304",
          primaryEmotion: "平静",
          signalType: "quiet-orbit",
          tags: ["清晨"],
          title: "第三段语义信号",
        }),
        distance: 0.4,
      },
    ]);

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal.matches.map((match) => match.id)).toEqual([
      "00000000-0000-4000-8000-000000000302",
      "00000000-0000-4000-8000-000000000303",
      "00000000-0000-4000-8000-000000000304",
    ]);
    expect(signal.matches[0]).toMatchObject({
      distance: 0.05,
      source: "PUBLISHED",
    });
    expect(signalStore.createdInputs[0]?.matchSignalId).toBe(
      "00000000-0000-4000-8000-000000000302",
    );
    await vi.waitFor(() => {
      expect(writeSignalEmbeddingIfMissing).toHaveBeenCalledWith({
        dimensions: 1024,
        embedding,
        id: "00000000-0000-4000-8000-000000000001",
        model: "text-embedding-v3",
        provider: "dashscope",
        version: "v1",
      });
    });
    expect(generateEmbedding).toHaveBeenCalledWith(
      expect.stringContaining(defaultExpansion.expandedText),
      expect.any(Object),
    );
  });

  it("falls back to keyword matches when semantic matching returns no candidates", async () => {
    vi.mocked(isEmbeddingProviderConfigured).mockResolvedValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      dimensions: 1024,
      embedding: Array.from({ length: 1024 }, () => 0.1),
      model: "text-embedding-v3",
      provider: "dashscope",
      version: "v1",
    });
    vi.mocked(listPublishedSemanticSignalMatchCandidates).mockResolvedValue([]);
    signalStore.matchCandidates = [
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000401",
        primaryEmotion: "孤独",
        signalType: "life-fragment",
        tags: ["孤独", "夜晚"],
        title: "关键词信号",
      }),
    ];

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal.matches[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000401",
      source: "PUBLISHED",
    });
  });

  it("falls back to keyword matches when embedding generation fails", async () => {
    vi.mocked(isEmbeddingProviderConfigured).mockResolvedValue(true);
    vi.mocked(generateEmbedding).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "Embedding provider unavailable."),
    );
    signalStore.matchCandidates = [
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000501",
        primaryEmotion: "孤独",
        signalType: "life-fragment",
        tags: ["孤独", "夜晚"],
        title: "关键词兜底信号",
      }),
    ];

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(signal.matches[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000501",
      source: "PUBLISHED",
    });
    expect(signalStore.createdInputs[0]?.matchSignalId).toBe(
      "00000000-0000-4000-8000-000000000501",
    );
  });

  it("keeps homepage creation when matching lookup fails", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    vi.mocked(listPublishedSignalMatchCandidates).mockRejectedValueOnce(
      new Error("matching store unavailable"),
    );

    const signal = await createPublishedSignal(
      testFrequency,
      {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      },
      logger,
    );

    expect(signal).toMatchObject({
      matches: [],
      status: "PUBLISHED",
    });
    expect(signalStore.createdInputs[0]).toMatchObject({
      matchSignalId: undefined,
      status: "PUBLISHED",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      {
        action: "signal.creation.failed",
        reason: "Error",
        signalCreationBoundary: "same_frequency_matching",
        targetType: "SIGNAL",
      },
      "signal creation boundary failed",
    );
  });

  it("uses seeded matches when no published match exists", async () => {
    const signal = await createPublishedSignal(testFrequency, {
      seedText: "今晚有点孤独，也有点想等一个回声。",
    });

    expect(signal.matches[0]).toMatchObject({
      id: "seed-life-fragment-001",
      source: "SEEDED",
    });
    expect(signalStore.createdInputs[0]?.matchSignalId).toBeUndefined();
  });

  it("builds minimal program metadata when no match exists", async () => {
    vi.mocked(generateSignalMaterial).mockResolvedValue({
      result: {
        classification: defaultClassification,
        expansion: defaultExpansion,
        fingerprint: {
          ...defaultFingerprint,
          displayText: "自我镜像 · 身份困惑",
          emotionTone: "清醒迟疑",
          primaryBand: "self_mirror",
          primaryEmotion: "困惑",
          resonanceKeywords: ["身份", "自我", "迟疑"],
          signalType: "self_mirror",
          subFeeling: "identity_confusion",
          tags: ["身份", "自我", "迟疑"],
          theme: "自我镜像",
        },
      },
      reviewId: "00000000-0000-4000-8000-000000000913",
    });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "清晨醒来，想把昨天轻轻放下。",
    });

    expect(signal.matches).toEqual([]);
    expect(signal.program).toMatchObject({
      bridgeNarration: "一条生活信号，暂未匹配到公开同频。",
      programTitle: "清晨醒来，想把昨天轻轻放下。",
    });
  });

  it("marks high-risk content as reviewing before publish", async () => {
    vi.mocked(generateSignalMaterial).mockResolvedValue({
      result: {
        classification: defaultClassification,
        expansion: defaultExpansion,
        fingerprint: {
          ...defaultFingerprint,
          riskLevel: "HIGH",
        },
      },
      reviewId: "00000000-0000-4000-8000-000000000913",
    });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "这是一段需要人工复核的高风险信号。",
    });

    expect(signal.status).toBe("REVIEWING");
    expect(signalStore.createdInputs[0]?.status).toBe("REVIEWING");
  });

  it("rejects direct signal creation without a frequency", async () => {
    await expect(
      createPublishedSignal(undefined, {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      statusCode: 401,
    });
    expect(generateSignalFingerprintWithFallback).not.toHaveBeenCalled();
  });

  it("surfaces controlled AI fallback errors when invalid provider output cannot be recovered", async () => {
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider returned invalid JSON."),
    );
    vi.mocked(generateSignalFingerprintWithFallback).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider returned invalid JSON."),
    );

    await expect(
      createPublishedSignal(testFrequency, {
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("logs signal expansion timeout details without provider secrets", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );
    vi.mocked(generateSignalExpansionWithFallback).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider timed out.", {
        boundary: "provider_call",
        fallbackBoundary: "provider_fallback",
        kind: "timeout",
        providerAttemptCount: 2,
        timeoutMs: 20000,
        type: "signal-expansion",
      }),
    );

    await expect(
      createPublishedSignal(
        testFrequency,
        {
          seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
        },
        logger,
      ),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      {
        action: "signal.expansion.failed",
        failureBoundary: "provider_call",
        failureFallbackBoundary: "provider_fallback",
        failureKind: "timeout",
        failureProviderAttemptCount: 2,
        failureTimeoutMs: 20000,
        failureType: "signal-expansion",
        reason: "AI_UNAVAILABLE",
        targetType: "SIGNAL",
      },
      "signal expansion failed",
    );
  });

  it("uses expansion fallback when provider output is invalid", async () => {
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );
    vi.mocked(generateSignalExpansionWithFallback).mockResolvedValue({
      result: defaultExpansion,
      reviewId: "00000000-0000-4000-8000-000000000909",
    });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "我发现自己一直在忙，却不知道到底想抵达哪里。",
    });

    expect(signal).toMatchObject({
      expandedText: defaultExpansion.expandedText,
      followUpQuestion: defaultExpansion.followUpQuestion,
    });
  });

  it("rewrites signal expansion once when critic rejects the first result", async () => {
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );
    const rejectedExpansion = {
      expandedText:
        "我把这句话留在心里，手机暗下去以后，房间只剩风声。都来打垒球这件事忽然变得孤独，好像人生一直绕着同一个问题走，没有人真的听见。",
      followUpQuestion: "你为什么这么累？",
    };
    const rewrittenExpansion = {
      expandedText:
        "有人把球棒从器材袋里抽出来，有人一边说自己不会，一边已经站到场边。球还没飞出去，笑声先滚了一圈。都来打垒球！没有人真正在乎比分，大家只是想找个理由跑起来。",
      followUpQuestion: "谁会先跑起来？",
    };
    vi.mocked(analyzeSignalIntentWithFallback).mockResolvedValue({
      result: {
        allowedInventions: ["场地", "身体动作", "人群声音"],
        confidence: 0.82,
        energy: "high",
        expansionMode: "light_scene",
        forbiddenInventions: [],
        inputKind: "wish",
        intendedFocus: "把邀约和场上动起来的热闹写出来",
        inventionLevel: "medium",
        keywords: ["垒球", "人群", "跑"],
        mustAvoid: [],
        mood: "lively",
        preserve: ["垒球"],
        sceneHint: "围绕场地、身体动作、节奏和人群声音展开",
        shouldBeNegative: false,
        type: "sports",
        userAct: "invite",
      },
      reviewId: "00000000-0000-4000-8000-000000000912",
    });
    vi.mocked(generateSignalExpansionWithFallback)
      .mockResolvedValueOnce({
        result: rejectedExpansion,
        reviewId: "00000000-0000-4000-8000-000000000908",
      })
      .mockResolvedValueOnce({
        result: rewrittenExpansion,
        reviewId: "00000000-0000-4000-8000-000000000909",
      });
    vi.mocked(reviewSignalExpansionWithFallback)
      .mockResolvedValueOnce({
        result: {
          hasConcreteObjects: false,
          hasSensoryDetails: false,
          isForcedNegative: true,
          isGenericLiteraryTemplate: true,
          matchesSeedType: false,
          pass: false,
          preservesOriginalDirection: true,
          problems: ["强行悲伤", "模板化"],
          rewriteInstruction: "按 sports 类型重写，写人群和动作，不要悲伤。",
          score: 3,
        },
        reviewId: "00000000-0000-4000-8000-000000000910",
      })
      .mockResolvedValueOnce({
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
        reviewId: "00000000-0000-4000-8000-000000000911",
      });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "都来打垒球！",
    });

    expect(signal.expandedText).toBe(rewrittenExpansion.expandedText);
    expect(generateSignalExpansionWithFallback).toHaveBeenCalledTimes(2);
    expect(generateSignalExpansionWithFallback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rewriteInstruction: "按 sports 类型重写，写人群和动作，不要悲伤。",
      }),
      undefined,
      { skipDirectionReview: true },
    );
    expect(signalStore.createdInputs[0]).toMatchObject({
      expandedText: rewrittenExpansion.expandedText,
      qualityScore: 4,
    });
  });

  it("accepts contradictory high-score expansion review instead of rewriting", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );
    vi.mocked(reviewSignalExpansionWithFallback).mockResolvedValue({
      result: {
        hasConcreteObjects: false,
        hasSensoryDetails: false,
        isForcedNegative: false,
        isGenericLiteraryTemplate: false,
        matchesSeedType: true,
        pass: false,
        preservesOriginalDirection: true,
        problems: [],
        rewriteInstruction: "",
        score: 9,
      },
      reviewId: "00000000-0000-4000-8000-000000000910",
    });

    const signal = await createPublishedSignal(
      testFrequency,
      {
        seedText: "你是什么人呢",
      },
      logger,
    );

    expect(signal.expandedText).toBe(defaultExpansion.expandedText);
    expect(generateSignalExpansionWithFallback).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        action: "signal.expansion.review_contradictory",
        reason: "INVALID_AI_REVIEW",
        targetType: "SIGNAL",
      },
      "signal expansion review contradicted itself",
    );
  });

  it("rewrites when the local direction review rejects the first expansion", async () => {
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );
    const rejectedExpansion = {
      expandedText:
        "都来打垒球！像一句被放进空房间里的口号，窗外有光慢慢落下，空气里只剩下轻轻的停顿。",
      followUpQuestion: "谁先动起来？",
    };
    const rewrittenExpansion = {
      expandedText:
        "有人把球棒从器材袋里抽出来，鞋底踩过土面，带起一点灰。都来打垒球！这句话一落下，场边先热起来，笑声绕着本垒滚了一圈，球还没飞出去，大家已经开始往前跑。",
      followUpQuestion: "谁会先跑起来？",
    };

    vi.mocked(analyzeSignalIntentWithFallback).mockResolvedValue({
      result: {
        allowedInventions: ["场地", "身体动作", "人群声音"],
        confidence: 0.82,
        energy: "high",
        expansionMode: "light_scene",
        forbiddenInventions: [],
        inputKind: "wish",
        intendedFocus: "把邀约和场上动起来的热闹写出来",
        inventionLevel: "medium",
        keywords: ["垒球", "人群", "跑"],
        mustAvoid: [],
        mood: "lively",
        preserve: ["垒球"],
        sceneHint: "围绕场地、身体动作、节奏和人群声音展开",
        shouldBeNegative: false,
        type: "sports",
        userAct: "invite",
      },
      reviewId: "00000000-0000-4000-8000-000000000912",
    });
    vi.mocked(generateSignalExpansionWithFallback)
      .mockResolvedValueOnce({
        result: rejectedExpansion,
        reviewId: "00000000-0000-4000-8000-000000000908",
      })
      .mockResolvedValueOnce({
        result: rewrittenExpansion,
        reviewId: "00000000-0000-4000-8000-000000000909",
      });
    vi.mocked(reviewSignalExpansionWithFallback)
      .mockResolvedValueOnce({
        result: {
          hasConcreteObjects: false,
          hasSensoryDetails: false,
          isForcedNegative: false,
          isGenericLiteraryTemplate: true,
          matchesSeedType: false,
          pass: false,
          preservesOriginalDirection: true,
          problems: ["没有写出 sports 应有的具体内容"],
          rewriteInstruction: "按 sports 类型重写，写人群和动作。",
          score: 4,
        },
        reviewId: "00000000-0000-4000-8000-000000000910",
      })
      .mockResolvedValueOnce({
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
        reviewId: "00000000-0000-4000-8000-000000000911",
      });

    const signal = await createPublishedSignal(testFrequency, {
      seedText: "都来打垒球！",
    });

    expect(signal.expandedText).toBe(rewrittenExpansion.expandedText);
    expect(generateSignalExpansionWithFallback).toHaveBeenCalledTimes(2);
    expect(generateSignalExpansionWithFallback).toHaveBeenNthCalledWith(
      1,
      {
        classification: expect.objectContaining({
          type: "sports",
        }),
        seedText: "都来打垒球！",
      },
      undefined,
      { skipDirectionReview: true },
    );
    expect(generateSignalExpansionWithFallback).toHaveBeenNthCalledWith(
      2,
      {
        classification: expect.objectContaining({
          type: "sports",
        }),
        rewriteInstruction: "按 sports 类型重写，写人群和动作。",
        seedText: "都来打垒球！",
      },
      undefined,
      { skipDirectionReview: true },
    );
  });

  it("surfaces AI unavailable when rewritten expansion still fails review", async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    vi.mocked(generateSignalMaterial).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );
    vi.mocked(generateSignalExpansionWithFallback)
      .mockResolvedValueOnce({
        result: defaultExpansion,
        reviewId: "00000000-0000-4000-8000-000000000908",
      })
      .mockResolvedValueOnce({
        result: defaultExpansion,
        reviewId: "00000000-0000-4000-8000-000000000909",
      });
    vi.mocked(reviewSignalExpansionWithFallback).mockResolvedValue({
      result: {
        hasConcreteObjects: false,
        hasSensoryDetails: false,
        isForcedNegative: false,
        isGenericLiteraryTemplate: true,
        matchesSeedType: false,
        pass: false,
        preservesOriginalDirection: false,
        problems: ["没有保留原句关键词"],
        rewriteInstruction: "保留原句关键词重写。",
        score: 3,
      },
      reviewId: "00000000-0000-4000-8000-000000000910",
    });

    await expect(
      createPublishedSignal(
        testFrequency,
        {
          seedText: "都来打垒球！",
        },
        logger,
      ),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(createSignalDraft).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        action: "signal.expansion.review_failed",
        problems: ["没有保留原句关键词"],
        reason: "AI_UNAVAILABLE",
        targetType: "SIGNAL",
      },
      "signal expansion review failed",
    );
  });

  it("generates published AI signals after quality check", async () => {
    const result = await generateAiSignals({ count: 1 });

    expect(result).toMatchObject({
      accepted: 1,
      attempts: 1,
      rejected: 0,
    });
    expect(signalStore.createdInputs[0]).toMatchObject({
      qualityReason: "内容具体自然。",
      qualityScore: 4,
      source: "ai_generated",
      status: "PUBLISHED",
    });
    expect(result.results[0]?.signal).toMatchObject({
      source: "ai_generated",
      status: "PUBLISHED",
    });
  });

  it("cycles personas when an AI signal batch requests more items than persona count", async () => {
    const result = await generateAiSignals({ count: 10 });

    expect(result).toMatchObject({
      accepted: 10,
      attempts: 10,
      rejected: 0,
    });
    expect(signalStore.createdInputs).toHaveLength(10);
    expect(generateSignalContentWithFallback).toHaveBeenCalledTimes(10);
  });

  it("rejects low-quality AI generated signals before insert", async () => {
    vi.mocked(scoreSignalQualityWithFallback).mockResolvedValue({
      result: {
        reason: "内容空泛。",
        score: 2,
      },
      reviewId: "00000000-0000-4000-8000-000000000907",
    });

    const result = await generateAiSignals({ count: 1 });

    expect(result).toMatchObject({
      accepted: 0,
      attempts: 3,
      rejected: 1,
    });
    expect(createSignalDraft).not.toHaveBeenCalled();
  });

  it("seeds a stable 40-signal library with fixed expanded text", async () => {
    const result = await seedSignalLibrary();

    expect(result).toMatchObject({
      accepted: 40,
      rejected: 0,
    });
    expect(listSignalsByRawInput).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));
    expect(signalStore.createdInputs[0]).toMatchObject({
      expandedText: expect.stringContaining("忙碌最会伪装成答案"),
      qualityReason: "固定种子内容，人工筛选通过。",
      qualityScore: 5,
      source: "seed",
      status: "PUBLISHED",
    });
    expect(generateSignalExpansionWithFallback).not.toHaveBeenCalled();
  });

  it("does not duplicate existing seed signals", async () => {
    vi.mocked(listSignalsByRawInput).mockResolvedValue([
      buildCandidate({
        id: "00000000-0000-4000-8000-000000000601",
        primaryEmotion: "孤独",
        rawInput: "我发现自己一直在忙，却不知道到底想抵达哪里。",
        signalType: "life-fragment",
        tags: ["孤独"],
        title: "已有种子",
      }),
    ]);

    const result = await seedSignalLibrary();

    expect(result.accepted).toBe(39);
    expect(signalStore.createdInputs).toHaveLength(39);
  });

  it("returns stable finite galaxy points and marks current frequency signals", async () => {
    const mySignal = buildCandidate({
      id: "00000000-0000-4000-8000-000000000701",
      primaryEmotion: "孤独",
      signalType: "life-fragment",
      tags: ["孤独", "夜晚"],
      title: "我的星点",
    });
    mySignal.frequencyId = "00000000-0000-4000-8000-000000000111";
    mySignal.authorFreqCode = "FM 27.51";
    mySignal.galaxyPosition = null;
    const matchedSignal = buildCandidate({
      id: "00000000-0000-4000-8000-000000000702",
      primaryEmotion: "孤独",
      signalType: "life-fragment",
      tags: ["夜晚"],
      title: "同频星点",
    });
    vi.mocked(listPublishedGalaxySignals).mockResolvedValue([mySignal, matchedSignal]);

    const galaxy = await getSignalGalaxy({
      createdAt: "2026-05-10T00:00:00.000Z",
      freqCode: "FM 27.51",
      id: "00000000-0000-4000-8000-000000000111",
      role: "USER",
      status: "ACTIVE",
    });

    expect(galaxy.points).toHaveLength(2);
    expect(galaxy.points[0]).toMatchObject({
      frequencyCode: "FM 27.51",
      id: "00000000-0000-4000-8000-000000000701",
      isMine: true,
      matchIds: ["00000000-0000-4000-8000-000000000702"],
    });
    expect(galaxy.themeOptions).toEqual(["孤独", "希望"]);
    expect(listPublishedGalaxyThemes).toHaveBeenCalledWith(12);
    expect(Number.isFinite(galaxy.points[0]?.position.x)).toBe(true);
    expect(writeSignalGalaxyPositionIfMissing).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000701",
      position: galaxy.points[0]?.position,
    });
  });

  it("keeps galaxy match ids inside the returned point set", async () => {
    const signal = buildCandidate({
      id: "00000000-0000-4000-8000-000000000721",
      primaryEmotion: "孤独",
      signalType: "life-fragment",
      tags: ["孤独", "夜晚"],
      title: "带历史匹配的星点",
    });
    signal.matchSignalId = "00000000-0000-4000-8000-000000000999";
    vi.mocked(listPublishedGalaxySignals).mockResolvedValue([signal]);

    const galaxy = await getSignalGalaxy(undefined);

    expect(galaxy.points).toHaveLength(1);
    expect(galaxy.points[0]?.matchIds).toEqual([]);
  });

  it("marks current frequency galaxy signals by author id during auth migration", async () => {
    const mySignal = buildCandidate({
      id: "00000000-0000-4000-8000-000000000711",
      primaryEmotion: "孤独",
      signalType: "life-fragment",
      tags: ["孤独", "夜晚"],
      title: "作者星点",
    });
    mySignal.authorId = "00000000-0000-4000-8000-000000000111";
    mySignal.frequencyId = null;
    vi.mocked(listPublishedGalaxySignals).mockResolvedValue([mySignal]);

    const galaxy = await getSignalGalaxy({
      createdAt: "2026-05-10T00:00:00.000Z",
      freqCode: "FM 27.51",
      id: "00000000-0000-4000-8000-000000000111",
      role: "USER",
      status: "ACTIVE",
    });

    expect(galaxy.points[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000711",
      isMine: true,
    });
  });
});
