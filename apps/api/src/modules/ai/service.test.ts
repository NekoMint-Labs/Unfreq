import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors.js";
import {
  analyzeContentWithFallback,
  analyzeSignalIntentWithFallback,
  classifyContent,
  classifyContentWithFallback,
  classifySignalSeedWithFallback,
  generateSignalExpansionWithFallback,
  generateSignalFingerprintWithFallback,
  generateSignalMaterial,
  generateSignalProgramWithFallback,
  reviewSignalExpansionWithFallback,
} from "./service.js";
import { createAiReviewRecord } from "./repository.js";
import {
  classifyWithProvider,
  contentAnalysisWithProvider,
  signalFingerprintWithProvider,
  signalExpansionReviewWithProvider,
  signalExpansionWithProvider,
  signalIntentAnalysisWithProvider,
  signalMaterialWithProvider,
  signalProgramWithProvider,
  signalSeedClassificationWithProvider,
} from "./provider.js";
import type { AiSignalFingerprint, AiSignalSeedClassification } from "./signal-types.js";

const testSignalFingerprint = {
  coreNeed: "希望被理解",
  displayText: "关系星云 · 被理解需求",
  energy: 0.48,
  emotionTone: "安静孤独",
  frequency: "SIG-LOCAL",
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
  title: "夜里的信号",
} satisfies AiSignalFingerprint;

const testSeedClassification = {
  allowedInventions: ["食物颜色", "气味", "口感"],
  confidence: 0.86,
  energy: "medium",
  expansionMode: "light_scene",
  forbiddenInventions: [],
  inputKind: "wish",
  intendedFocus: "写出想吃这道菜的香气和口感",
  inventionLevel: "medium",
  keywords: ["糖醋排骨", "酸甜", "酱汁"],
  mustAvoid: [],
  mood: "warm",
  preserve: ["糖醋排骨"],
  sceneHint: "围绕具体食物、气味、口感或餐桌动作展开",
  shouldBeNegative: false,
  type: "food",
  userAct: "make_wish",
} satisfies AiSignalSeedClassification;

const testEmotionSeedClassification = {
  allowedInventions: ["语气变化", "距离感", "停顿"],
  confidence: 0.84,
  energy: "medium",
  expansionMode: "clarify_thought",
  forbiddenInventions: ["厨房", "做饭", "饮食照料", "剧情化人物"],
  inputKind: "original_thought",
  intendedFocus: "写出关系里爱意变淡或落差被察觉的清醒感",
  inventionLevel: "low",
  keywords: ["爱", "不爱", "明显"],
  mustAvoid: ["厨房", "做饭", "饮食照料"],
  mood: "清醒",
  preserve: ["爱", "不爱", "明显"],
  sceneHint: "写关系、语气、距离或态度变化里显出来的情感落差",
  shouldBeNegative: false,
  type: "emotion",
  userAct: "state_opinion",
} satisfies AiSignalSeedClassification;

vi.mock("./provider.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./provider.js")>();

  return {
    ...original,
    classifyWithProvider: vi.fn(),
    contentAnalysisWithProvider: vi.fn(),
    signalFingerprintWithProvider: vi.fn(),
    signalExpansionReviewWithProvider: vi.fn(),
    signalExpansionWithProvider: vi.fn(),
    signalIntentAnalysisWithProvider: vi.fn(),
    signalMaterialWithProvider: vi.fn(),
    signalProgramWithProvider: vi.fn(),
    signalSeedClassificationWithProvider: vi.fn(),
  };
});

vi.mock("./repository.js", () => {
  return {
    createAiReviewRecord: vi.fn((params: { status: "FALLBACK" | "SUCCEEDED" }) => {
      return Promise.resolve({
        createdAt: "2026-05-10T12:00:00.000Z",
        id:
          params.status === "FALLBACK"
            ? "00000000-0000-4000-8000-000000000801"
            : "00000000-0000-4000-8000-000000000802",
        inputText: "凌晨一点，我还在想念那段声音。",
        model: "test-model",
        outputJson: {},
        provider: "test-provider",
        reviewType: "classify",
        status: params.status,
      });
    }),
  };
});

beforeEach(() => {
  vi.mocked(classifyWithProvider).mockReset();
  vi.mocked(contentAnalysisWithProvider).mockReset();
  vi.mocked(signalFingerprintWithProvider).mockReset();
  vi.mocked(signalExpansionReviewWithProvider).mockReset();
  vi.mocked(signalExpansionWithProvider).mockReset();
  vi.mocked(signalIntentAnalysisWithProvider).mockReset();
  vi.mocked(signalMaterialWithProvider).mockReset();
  vi.mocked(signalProgramWithProvider).mockReset();
  vi.mocked(signalSeedClassificationWithProvider).mockReset();
  vi.mocked(createAiReviewRecord).mockClear();
});

describe("ai service", () => {
  it("returns AI_UNAVAILABLE for direct AI calls when provider output is invalid", async () => {
    vi.mocked(classifyWithProvider).mockResolvedValue({
      channel: "MIDNIGHT",
      confidence: 2,
      reason: "invalid confidence",
    });

    await expect(
      classifyContent({ content: "凌晨一点，我还在想念那段声音。" }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(createAiReviewRecord).not.toHaveBeenCalled();
  });

  it("records fallback result for business callers when provider is unavailable", async () => {
    vi.mocked(classifyWithProvider).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );

    const result = await classifyContentWithFallback({
      content: "凌晨一点，我还在想念那段声音。",
    });

    expect(result).toMatchObject({
      reviewId: "00000000-0000-4000-8000-000000000801",
      result: {
        channel: "MIDNIGHT",
      },
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "classify",
        status: "FALLBACK",
      }),
    );
  });

  it("records validated content analysis fallback for business callers", async () => {
    vi.mocked(contentAnalysisWithProvider).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider unavailable."),
    );

    const result = await analyzeContentWithFallback({
      content: "今晚有点孤独，也有点想念。",
    });

    expect(result.result).toMatchObject({
      emotions: expect.arrayContaining(["孤独", "想念"]),
      riskLevel: "LOW",
      summary: "今晚有点孤独，也有点想念。",
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "content-analysis",
        status: "FALLBACK",
      }),
    );
  });

  it("records signal fingerprint fallback when provider output is invalid", async () => {
    vi.mocked(signalFingerprintWithProvider).mockResolvedValue({
      ...testSignalFingerprint,
      energy: 2,
      frequency: "SIG-BAD",
      hiddenNeed: "",
      narrativeConflict: "",
      openness: 0.5,
      primaryEmotion: "孤独",
      secondaryEmotions: [],
      tags: [],
      theme: "",
      title: "",
    });

    const result = await generateSignalFingerprintWithFallback({
      content: "今晚有点孤独，也有点想念。",
    });

    expect(result.result).toMatchObject({
      frequency: expect.stringMatching(/^SIG-/),
      riskLevel: "LOW",
      signalType: "relationship_nebula",
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-fingerprint",
        status: "FALLBACK",
      }),
    );
  });

  it("normalizes mismatched signal fingerprint frequency options", async () => {
    vi.mocked(signalFingerprintWithProvider).mockResolvedValue({
      ...testSignalFingerprint,
      displayText: "关系星云 · 努力怀疑",
      primaryBand: "relationship_nebula",
      primaryEmotion: "努力怀疑",
      signalType: "custom-label",
      subFeeling: "effort_doubt",
      theme: "关系星云",
    });

    const result = await generateSignalFingerprintWithFallback({
      content: "今晚有点孤独，也有点想念。",
    });

    expect(result.result).toMatchObject({
      displayText: "关系星云 · 被理解需求",
      primaryBand: "relationship_nebula",
      primaryEmotion: "被理解需求",
      signalType: "relationship_nebula",
      subFeeling: "need_to_be_understood",
      theme: "关系星云",
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-fingerprint",
        status: "SUCCEEDED",
      }),
    );
  });

  it("records signal program fallback when provider output is invalid", async () => {
    vi.mocked(signalProgramWithProvider).mockResolvedValue({
      programTitle: "",
    } as unknown as Awaited<ReturnType<typeof signalProgramWithProvider>>);

    const result = await generateSignalProgramWithFallback({
      fingerprint: testSignalFingerprint,
      rawInput: "今晚有点孤独，也有点想念。",
    });

    expect(result.result).toMatchObject({
      programTitle: "夜里的信号 / 同频试播",
      shareQuote: expect.any(String),
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-program",
        status: "FALLBACK",
      }),
    );
  });

  it("rejects invalid signal expansion provider output without local literary fallback", async () => {
    vi.mocked(signalExpansionWithProvider).mockResolvedValue({
      expandedText: "我把这句种子放在夜里反复看：今晚想把这段匿名信号留在这里。",
      followUpQuestion: "你最近一次意识到自己在绕开什么，是在哪个瞬间？",
    });

    await expect(
      generateSignalExpansionWithFallback({
        classification: testSeedClassification,
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(createAiReviewRecord).not.toHaveBeenCalled();
  });

  it("rejects signal expansion output that repeats blocked templates", async () => {
    vi.mocked(signalExpansionWithProvider).mockResolvedValue({
      expandedText:
        "我把这句话留在心里：sekai..。窗外车声慢下来，桌面还摊着没收好的纸，我把外套搭回椅背，口袋里的钥匙轻轻响了一下。我没有急着把它说出口，只是突然发现，自己已经很久没有把真实感受放到前面。",
      followUpQuestion: "你最近在哪里听见过自己的停顿？",
    });

    await expect(
      generateSignalExpansionWithFallback({
        classification: testSeedClassification,
        seedText: "sekai..",
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(createAiReviewRecord).not.toHaveBeenCalled();
  });

  it("keeps signal expansion provider outages visible instead of writing local prose", async () => {
    vi.mocked(signalExpansionWithProvider).mockRejectedValue(
      new AppError("AI_UNAVAILABLE", "AI provider timed out."),
    );

    await expect(
      generateSignalExpansionWithFallback({
        classification: testSeedClassification,
        seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(createAiReviewRecord).not.toHaveBeenCalled();
  });

  it("rejects signal expansion output that drifts into food-care scenes", async () => {
    vi.mocked(signalExpansionWithProvider).mockResolvedValue({
      expandedText:
        "她递来一杯温水，指尖碰了碰杯壁，试了温度才松手。厨房里飘出姜丝红糖的气味，他往锅里多撒了一把红枣。她没说话，只是把杯子轻轻推回他手边，水面晃了晃，映出窗外的光。",
      followUpQuestion: "你先看见了什么？",
    });

    await expect(
      generateSignalExpansionWithFallback({
        classification: testEmotionSeedClassification,
        seedText: "爱与不爱还是很明显的",
      }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 503,
    });
    expect(createAiReviewRecord).not.toHaveBeenCalled();
  });

  it("records combined signal material when provider output is valid", async () => {
    vi.mocked(signalMaterialWithProvider).mockResolvedValue({
      classification: testSeedClassification,
      expansion: {
        expandedText:
          "糖醋排骨刚出锅，酱汁在盘底慢慢发亮。筷子夹起来时，酸甜味先碰到鼻尖，米饭旁边落了几滴红亮的汁。厨房门口有人催菜，桌边已经空出一个位置，只等这盘菜端过去，热气还贴着盘沿。",
        followUpQuestion: "第一口想给谁？",
      },
      fingerprint: testSignalFingerprint,
    });

    const result = await generateSignalMaterial({
      content: "我想吃糖醋排骨",
    });

    expect(result.result).toMatchObject({
      classification: {
        type: "food",
      },
      expansion: {
        followUpQuestion: "第一口想给谁？",
      },
      fingerprint: {
        frequency: "SIG-LOCAL",
      },
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-material",
        status: "SUCCEEDED",
      }),
    );
  });

  it("records signal seed classification fallback when provider output is invalid", async () => {
    vi.mocked(signalSeedClassificationWithProvider).mockResolvedValue({
      energy: "extreme",
      expansionMode: "",
      keywords: [],
      mood: "",
      shouldBeNegative: false,
      type: "food",
    } as unknown as Awaited<ReturnType<typeof signalSeedClassificationWithProvider>>);

    const result = await classifySignalSeedWithFallback({
      content: "我想吃糖醋排骨",
    });

    expect(result.result).toMatchObject({
      expansionMode: "light_scene",
      inputKind: "wish",
      inventionLevel: "medium",
      shouldBeNegative: false,
      type: "food",
      userAct: "make_wish",
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-seed-classification",
        status: "FALLBACK",
      }),
    );
  });

  it("records signal intent analysis fallback when provider output is invalid", async () => {
    vi.mocked(signalIntentAnalysisWithProvider).mockResolvedValue({
      confidence: 2,
      energy: "medium",
      expansionMode: "overbuilt_scene",
      keywords: [],
      mood: "quiet",
      shouldBeNegative: false,
      type: "poetry",
    } as unknown as Awaited<ReturnType<typeof signalIntentAnalysisWithProvider>>);

    const result = await analyzeSignalIntentWithFallback({
      content: "空山新雨后，天气晚来秋",
    });

    expect(result.result).toMatchObject({
      expansionMode: "aftertaste",
      inputKind: "classic_poem",
      inventionLevel: "none",
      type: "poetry",
      userAct: "quote_for_aftertaste",
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-intent-analysis",
        status: "FALLBACK",
      }),
    );
  });

  it("records signal expansion review fallback when provider output is invalid", async () => {
    vi.mocked(signalExpansionReviewWithProvider).mockResolvedValue({
      pass: "no",
      problems: [],
      rewriteInstruction: "",
      score: 20,
    } as unknown as Awaited<ReturnType<typeof signalExpansionReviewWithProvider>>);

    const result = await reviewSignalExpansionWithFallback({
      classification: testSeedClassification,
      expandedText:
        "糖醋排骨刚出锅，酱汁还在盘底慢慢发亮。筷子夹起来时，酸甜味先碰到鼻尖，米饭旁边落了几滴红亮的汁。有人在厨房门口催一声，桌边已经空出一个位置，只等这盘菜端过去，连热气都像在催人坐下。",
      seedText: "我想吃糖醋排骨",
    });

    expect(result.result).toMatchObject({
      hasConcreteObjects: true,
      hasSensoryDetails: true,
      matchesSeedType: true,
      pass: true,
      preservesOriginalDirection: true,
      score: 8.5,
    });
    expect(createAiReviewRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewType: "signal-expansion-review",
        status: "FALLBACK",
      }),
    );
  });
});
