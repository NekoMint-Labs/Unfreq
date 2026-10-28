import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  classifySignalSeedFallback,
  classifyWithProvider,
  signalContentFallback,
  signalExpansionFallback,
  signalExpansionReviewFallback,
  signalMaterialWithProvider,
  signalExpansionWithProvider,
  signalQualityFallback,
  signalContentWithProvider,
} from "./provider.js";
import type { AiSignalSeedClassification } from "./signal-types.js";

type FetchCallOptions = {
  body: string;
  signal?: AbortSignal;
};

type FetchMock = Mock<(url: string, options: FetchCallOptions) => Promise<Response>>;

const foodClassification: AiSignalSeedClassification = {
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
};

const sportsClassification: AiSignalSeedClassification = {
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
};

const poetryClassification: AiSignalSeedClassification = {
  allowedInventions: ["空气", "光线", "水声"],
  confidence: 0.84,
  energy: "low",
  expansionMode: "aftertaste",
  forbiddenInventions: ["人物", "现代物件", "完整剧情", "解释诗句"],
  inputKind: "classic_poem",
  intendedFocus: "保留雨后秋山的清冷画面",
  inventionLevel: "none",
  keywords: ["山", "雨", "秋"],
  mustAvoid: ["人物", "现代物件", "完整剧情", "解释诗句"],
  mood: "quiet",
  preserve: ["山", "雨", "秋"],
  sceneHint: "围绕自然景物、季节、空气和声音展开",
  shouldBeNegative: false,
  type: "poetry",
  userAct: "quote_for_aftertaste",
};

const emotionClassification: AiSignalSeedClassification = {
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
};

const providerConfigState = vi.hoisted(() => {
  return {
    config: {
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      provider: "deepseek",
    },
    configs: undefined as
      | Array<{
          apiKey: string;
          baseUrl: string;
          profile?: "default" | "fast";
          model: string;
          provider: string;
        }>
      | undefined,
  };
});

vi.mock("./provider-config.js", () => {
  return {
    resolveChatProviderConfig: vi.fn(() => Promise.resolve(providerConfigState.config)),
    resolveChatProviderConfigs: vi.fn(() =>
      Promise.resolve(providerConfigState.configs ?? [providerConfigState.config]),
    ),
  };
});

beforeEach(() => {
  vi.restoreAllMocks();
  providerConfigState.config = {
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    provider: "deepseek",
  };
  providerConfigState.configs = undefined;
});

describe("ai provider adapter", () => {
  it("disables DeepSeek thinking for JSON chat completions", async () => {
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    channel: "MIDNIGHT",
                    confidence: 0.8,
                    reason: "夜间倾诉。",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await classifyWithProvider("凌晨一点，我还在想念那段声音。");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        body: expect.any(String),
      }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, FetchCallOptions];

    expect(JSON.parse(options.body)).toMatchObject({
      model: "deepseek-v4-flash",
      response_format: {
        type: "json_object",
      },
      thinking: {
        type: "disabled",
      },
    });
  });

  it("calls combined signal material provider with the signal-material prompt", async () => {
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    classification: foodClassification,
                    expansion: {
                      expandedText:
                        "糖醋排骨刚出锅，酱汁在盘底慢慢发亮。筷子夹起来时，酸甜味先碰到鼻尖，米饭旁边落了几滴红亮的汁。厨房门口有人催菜，桌边已经空出一个位置，只等这盘菜端过去。",
                      followUpQuestion: "第一口想给谁？",
                    },
                    fingerprint: {
                      coreNeed: "确认自己的感受能被理解",
                      displayText: "情绪暗流 · 焦虑",
                      emotionTone: "轻微期待",
                      energy: 0.62,
                      frequency: "SIG-FOOD",
                      hiddenNeed: "确认自己的感受能被理解",
                      innerConflict: "想继续往前，又怀疑自己是否真的被看见",
                      narrativeConflict: "想继续往前，又怀疑自己是否真的被看见",
                      openness: 0.54,
                      primaryBand: "emotional_undercurrent",
                      primaryEmotion: "焦虑",
                      resonanceKeywords: ["期待", "食物"],
                      riskLevel: "LOW",
                      secondaryEmotions: ["期待"],
                      signalType: "emotional_undercurrent",
                      subFeeling: "anxiety",
                      tags: ["期待", "食物"],
                      theme: "情绪暗流",
                      title: "想吃糖醋排骨",
                    },
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await signalMaterialWithProvider("我想吃糖醋排骨");

    const [, options] = fetchMock.mock.calls[0] as [string, FetchCallOptions];
    const body = JSON.parse(options.body);

    expect(body.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("classification"),
    });
    expect(body.messages[1]).toMatchObject({
      role: "user",
      content: "我想吃糖醋排骨",
    });
  });

  it("keeps non-DeepSeek request bodies OpenAI-compatible", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    channel: "MIDNIGHT",
                    confidence: 0.8,
                    reason: "夜间倾诉。",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await classifyWithProvider("凌晨一点，我还在想念那段声音。");

    const [, options] = fetchMock.mock.calls[0] as [string, FetchCallOptions];

    expect(JSON.parse(options.body)).not.toHaveProperty("thinking");
    expect(JSON.parse(options.body)).not.toHaveProperty("temperature");
  });

  it("routes judgment calls to the fast chat profile", async () => {
    providerConfigState.configs = [
      {
        apiKey: "sk-fast",
        baseUrl: "https://fast-chat.example.com/v1",
        profile: "fast",
        model: "fast-chat",
        provider: "openai-compatible",
      },
      {
        apiKey: "sk-default",
        baseUrl: "https://default-chat.example.com/v1",
        profile: "default",
        model: "default-chat",
        provider: "openai-compatible",
      },
    ];
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    channel: "MIDNIGHT",
                    confidence: 0.8,
                    reason: "夜间倾诉。",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await classifyWithProvider("凌晨一点，我还在想念那段声音。");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://fast-chat.example.com/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining("fast-chat"),
      }),
    );
  });

  it("routes creative signal expansion calls to the default chat profile", async () => {
    providerConfigState.configs = [
      {
        apiKey: "sk-fast",
        baseUrl: "https://fast-chat.example.com/v1",
        profile: "fast",
        model: "fast-chat",
        provider: "openai-compatible",
      },
      {
        apiKey: "sk-default",
        baseUrl: "https://default-chat.example.com/v1",
        profile: "default",
        model: "default-chat",
        provider: "openai-compatible",
      },
    ];
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    expandedText:
                      "糖醋排骨这念头一冒出来，锅里的酱汁像已经在冒泡。排骨裹着红亮的糖醋汁，筷子一碰就沾住一点酸甜香气。米饭盛在旁边，厨房门口有人探头催菜，热气往桌边散，连盘沿都像在等第一口。",
                    followUpQuestion: "第一口想给谁？",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await signalExpansionWithProvider({
      classification: foodClassification,
      seedText: "我想吃糖醋排骨",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://default-chat.example.com/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining("default-chat"),
      }),
    );
  });

  it("skips empty chat configs before falling back to local output", async () => {
    providerConfigState.configs = [
      {
        apiKey: "",
        baseUrl: "",
        model: "empty-env",
        provider: "environment",
      },
      {
        apiKey: "sk-next",
        baseUrl: "https://chat-next.example.com/v1",
        model: "next-chat",
        provider: "openai-compatible",
      },
    ];
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    expandedText:
                      "糖醋排骨这念头一冒出来，锅里的酱汁像已经在冒泡。排骨裹着红亮的糖醋汁，筷子一碰就沾住一点酸甜香气。米饭盛在旁边，厨房门口有人探头催菜，热气往桌边散，连盘沿都像在等第一口。",
                    followUpQuestion: "第一口想给谁？",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await signalExpansionWithProvider({
      classification: foodClassification,
      seedText: "我想吃糖醋排骨",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat-next.example.com/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining("next-chat"),
      }),
    );
  });

  it("marks missing chat provider config with the config resolution boundary", async () => {
    providerConfigState.configs = [
      {
        apiKey: "",
        baseUrl: "",
        model: "empty-env",
        provider: "environment",
      },
    ];
    const fetchMock: FetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyWithProvider("凌晨一点，我还在想念那段声音。")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_config_resolution",
        kind: "config_missing",
        type: "classify",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks provider call failures with fallback diagnostics after all candidates fail", async () => {
    providerConfigState.configs = [
      {
        apiKey: "sk-first",
        baseUrl: "https://chat-first.example.com/v1",
        model: "first-chat",
        provider: "openai-compatible",
      },
      {
        apiKey: "sk-second",
        baseUrl: "https://chat-second.example.com/v1",
        model: "second-chat",
        provider: "openai-compatible",
      },
    ];
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "provider unavailable" }), {
          status: 503,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyWithProvider("凌晨一点，我还在想念那段声音。")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_call",
        fallbackBoundary: "provider_fallback",
        kind: "http_error",
        providerAttemptCount: 2,
        statusCode: 503,
        type: "classify",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks invalid chat response content with fallback diagnostics", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {},
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyWithProvider("凌晨一点，我还在想念那段声音。")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_call",
        fallbackBoundary: "provider_fallback",
        kind: "invalid_response",
        providerAttemptCount: 1,
        type: "classify",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks invalid chat response JSON with fallback diagnostics", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "not json",
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyWithProvider("凌晨一点，我还在想念那段声音。")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_call",
        fallbackBoundary: "provider_fallback",
        kind: "invalid_json",
        providerAttemptCount: 1,
        type: "classify",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks network provider failures with fallback diagnostics", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    const fetchMock: FetchMock = vi.fn(() => Promise.reject(new Error("socket closed")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(classifyWithProvider("凌晨一点，我还在想念那段声音。")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        boundary: "provider_call",
        fallbackBoundary: "provider_fallback",
        kind: "network_error",
        providerAttemptCount: 1,
        type: "classify",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks signal expansion timeouts with structured details after the expanded window", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: FetchCallOptions) => {
        return new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );
    vi.useFakeTimers();

    const promise = signalExpansionWithProvider({
      classification: foodClassification,
      seedText: "我想吃糖醋排骨",
    });
    const expectation = expect(promise).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        kind: "timeout",
        timeoutMs: 20000,
        type: "signal-expansion",
      },
    });

    await vi.advanceTimersByTimeAsync(20000);
    await expectation;
  });

  it("keeps fast judgment chat provider calls on the 10 second timeout window", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: FetchCallOptions) => {
        return new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );
    vi.useFakeTimers();

    const promise = classifyWithProvider("凌晨一点，我还在想念那段声音。");
    const expectation = expect(promise).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      details: {
        kind: "timeout",
        timeoutMs: 10000,
        type: "classify",
      },
    });

    await vi.advanceTimersByTimeAsync(10000);
    await expectation;
  });

  it("adds creative generation controls for AI signal content", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    rawInput: "我在末班地铁把那句话删掉，怕一发出去，就再也装不了平静。",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await signalContentWithProvider({
      age: 22,
      commonScenes: ["末班地铁"],
      currentConcern: "怕自己跟不上团队节奏",
      fmName: "FM-21.07",
      occupation: "实习生",
      style: "短句、克制、带一点自我怀疑",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, FetchCallOptions];

    expect(JSON.parse(options.body)).toMatchObject({
      frequency_penalty: 0.25,
      presence_penalty: 0.35,
      temperature: 0.9,
      top_p: 0.92,
    });
  });

  it("instructs signal expansion providers to avoid fixed scaffolds", async () => {
    providerConfigState.config = {
      apiKey: "sk-test",
      baseUrl: "https://chat.example.com/v1",
      model: "example-chat",
      provider: "openai-compatible",
    };
    const fetchMock: FetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    expandedText:
                      "屏幕暗下去的时候，房间里只剩空调细小的声响，我把杯沿转了一圈，又停住。今晚想把这段匿名信号留在这里这件事没有被我说得很重，却一直在旁边。那一点停顿比解释更早露出来。",
                    followUpQuestion: "你最近把哪句话留在了原地？",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await signalExpansionWithProvider({
      classification: foodClassification,
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    const [, options] = fetchMock.mock.calls[0] as [string, FetchCallOptions];
    const requestBody = JSON.parse(options.body) as {
      messages: Array<{ content: string; role: string }>;
    };

    expect(requestBody.messages[0]?.content).toContain("classification.shouldBeNegative");
    expect(requestBody.messages[0]?.content).toContain("Use only seedText and classification");
    expect(requestBody.messages[0]?.content).toContain("Do not write a signal");
    expect(requestBody.messages[0]?.content).toContain("Do not mention resonance, frequency, signal, radio");
    expect(requestBody.messages[0]?.content).toContain("信号, 频率, 频段, 电台");
    expect(requestBody.messages[0]?.content).toContain("For non-food seeds");
    expect(requestBody.messages[0]?.content).toContain("For emotion seeds");
    expect(requestBody.messages[0]?.content).toContain("seedText is already displayed separately");
    expect(requestBody.messages[0]?.content).toContain("Never concatenate seedText directly");
    expect(requestBody.messages[0]?.content).toContain("For quote or classic-poem-like input");
    expect(requestBody.messages[0]?.content).toContain("intendedFocus");
    expect(requestBody.messages[0]?.content).toContain("classification.mustAvoid");
    expect(requestBody.messages[0]?.content).toContain("classification.inputKind");
    expect(requestBody.messages[0]?.content).toContain("classification.inventionLevel");
    expect(requestBody.messages[0]?.content).toContain("classification.forbiddenInventions");
    expect(requestBody.messages[0]?.content).toContain("我把这句话留在心里");
    expect(requestBody.messages[0]?.content).toContain("Before returning, silently check");
    expect(requestBody.messages[1]?.content).not.toContain("fingerprint");
    expect(requestBody.messages[1]?.content).not.toContain("安静孤独");
    expect(requestBody.messages[1]?.content).not.toContain("primaryBand");
    expect(requestBody.messages[1]?.content).not.toContain("riskLevel");
  });

  it("classifies food and sports seeds for type-directed provider prompts", () => {
    expect(classifySignalSeedFallback("我想吃糖醋排骨")).toMatchObject({
      expansionMode: "light_scene",
      inputKind: "wish",
      inventionLevel: "medium",
      shouldBeNegative: false,
      type: "food",
      userAct: "make_wish",
    });
    expect(classifySignalSeedFallback("都来打垒球！")).toMatchObject({
      energy: "high",
      expansionMode: "light_scene",
      shouldBeNegative: false,
      type: "sports",
      userAct: "invite",
    });
  });

  it("classifies obvious relationship contrast seeds as emotion locally", () => {
    expect(classifySignalSeedFallback("爱与不爱还是很明显的")).toMatchObject({
      expansionMode: "clarify_thought",
      forbiddenInventions: expect.arrayContaining(["厨房", "做饭", "饮食照料", "剧情化人物"]),
      inputKind: "original_thought",
      inventionLevel: "low",
      mustAvoid: expect.arrayContaining(["厨房", "做饭", "饮食照料"]),
      shouldBeNegative: false,
      type: "emotion",
      userAct: "state_opinion",
    });
  });

  it("classifies representative intent-analysis seeds locally", () => {
    expect(classifySignalSeedFallback("空山新雨后，天气晚来秋")).toMatchObject({
      expansionMode: "aftertaste",
      forbiddenInventions: expect.arrayContaining(["人物", "现代物件", "完整剧情", "解释诗句"]),
      inputKind: "classic_poem",
      inventionLevel: "none",
      type: "poetry",
      userAct: "quote_for_aftertaste",
    });
    expect(classifySignalSeedFallback("蓝色回形针在抽屉里睡觉")).toMatchObject({
      expansionMode: "continue_image",
      forbiddenInventions: expect.arrayContaining(["人生哲理", "关系解释"]),
      inputKind: "absurd",
      inventionLevel: "low",
      type: "absurd",
    });
  });

  it("classifies compact oral odd seeds as low-invention fragments", () => {
    expect(classifySignalSeedFallback("大家夸小王是小强棒")).toMatchObject({
      expansionMode: "clarify_thought",
      forbiddenInventions: expect.arrayContaining(["完整职场场景", "把怪句改写成普通表扬"]),
      inputKind: "fragment",
      inventionLevel: "low",
      mustAvoid: expect.arrayContaining(["完整职场场景", "新增任务"]),
      preserve: ["大家夸小王是小强棒"],
      type: "unknown",
      userAct: "record_fragment",
    });
  });

  it("keeps local signal content fallback concrete and varied", () => {
    const result = signalContentFallback({
      age: 22,
      commonScenes: ["末班地铁"],
      currentConcern: "怕自己跟不上团队节奏，又不敢承认已经很累",
      fmName: "FM-21.07",
      occupation: "实习生",
      style: "短句、克制、带一点自我怀疑",
    });

    expect(result.rawInput).toContain("末班地铁");
    expect(result.rawInput).not.toContain("显得自己太在意");
    expect(result.rawInput.length).toBeLessThanOrEqual(100);
  });

  it("keeps local signal expansion fallback away from the old fixed template", () => {
    const result = signalExpansionFallback({
      classification: foodClassification,
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });

    expect(result.expandedText).not.toContain("夜里反复看");
    expect(result.expandedText).not.toContain("桌上的杯子已经凉了");
    expect(result.expandedText).not.toContain("我把这句话留在心里");
    expect(result.expandedText).not.toContain("我没有急着把它说出口");
    expect(result.expandedText.length).toBeGreaterThanOrEqual(80);
    expect(result.expandedText.length).toBeLessThanOrEqual(180);
    expect(result.followUpQuestion).toMatch(/[?？]$/u);
  });

  it("uses type-directed local expansion fallback for representative seeds", () => {
    const food = signalExpansionFallback({
      classification: foodClassification,
      seedText: "我想吃糖醋排骨",
    });
    const sports = signalExpansionFallback({
      classification: sportsClassification,
      seedText: "都来打垒球！",
    });
    const poetry = signalExpansionFallback({
      classification: poetryClassification,
      seedText: "空山新雨后，天气晚来秋",
    });

    expect(food.expandedText).toMatch(/糖醋|排骨|酱汁|米饭/u);
    expect(sports.expandedText).toMatch(/球|场|跑|球棒|手套/u);
    expect(poetry.expandedText).toMatch(/山|雨|秋|风|水/u);
    expect(sports.expandedText).not.toMatch(/孤独|疲惫|遗憾|人生/u);
    expect(food.expandedText).not.toMatch(/孤独|疲惫|遗憾|人生/u);
    expect(poetry.expandedText).not.toMatch(/手机|杯子|房间只剩风声/u);
  });

  it("corrects local expansion fallback when classification mislabels a non-food seed as food", () => {
    const result = signalExpansionFallback({
      classification: foodClassification,
      seedText: "爱与不爱还是很明显的",
    });

    expect(result.expandedText).toMatch(/爱与不爱|晚安|眼神|语气|距离/u);
    expect(result.expandedText).not.toMatch(/厨房|排骨|酱汁|米饭|糖醋|红糖|红枣|温水/u);
  });

  it("rejects non-food emotion expansions that drift into food-care scenes", () => {
    expect(
      signalExpansionReviewFallback({
        classification: emotionClassification,
        expandedText:
          "她递来一杯温水，指尖碰了碰杯壁，试了温度才松手。厨房里飘出姜丝红糖的气味，他往锅里多撒了一把红枣。她没说话，只是把杯子轻轻推回他手边，水面晃了晃，映出窗外的光。",
        seedText: "爱与不爱还是很明显的",
      }),
    ).toMatchObject({
      matchesSeedType: false,
      pass: false,
      problems: expect.arrayContaining(["原句未出现食物材料，但扩写写成了厨房、饮食或照料场景"]),
    });
  });

  it("rejects food-typed expansions when the seed itself has no food material", () => {
    expect(
      signalExpansionReviewFallback({
        classification: foodClassification,
        expandedText:
          "她递来一杯温水，指尖碰了碰杯壁，试了温度才松手。厨房里飘出姜丝红糖的气味，他往锅里多撒了一把红枣。她没说话，只是把杯子轻轻推回他手边，水面晃了晃，映出窗外的光。",
        seedText: "爱与不爱还是很明显的",
      }),
    ).toMatchObject({
      matchesSeedType: false,
      pass: false,
      problems: expect.arrayContaining(["原句未出现食物材料，但扩写写成了厨房、饮食或照料场景"]),
    });
  });

  it("allows emotion expansions that preserve the original contrast without food drift", () => {
    expect(
      signalExpansionReviewFallback({
        classification: emotionClassification,
        expandedText:
          "聊天框停在最后一行，他看见那句晚安隔了很久才出现。手指悬在屏幕上，没有按下去。真正明显的不是字数，而是对方每一次避开的眼神、忽然变轻的语气，还有爱意先退开半步的距离。",
        seedText: "爱与不爱还是很明显的",
      }),
    ).toMatchObject({
      matchesSeedType: true,
      pass: true,
      preservesOriginalDirection: true,
    });
  });

  it("rejects expansions that violate low-invention forbidden boundaries", () => {
    expect(
      signalExpansionReviewFallback({
        classification: poetryClassification,
        expandedText:
          "空山的雨意还没退，松针挂着水光，晚秋的凉从石阶一点点漫开。后来他拿出手机拍下这一幕，发给远方的朋友，故事从这里开始有了结局，像一场终于说出口的告别。",
        seedText: "空山新雨后，天气晚来秋",
      }),
    ).toMatchObject({
      pass: false,
      problems: expect.arrayContaining(["扩写违背了可脑补边界"]),
    });
  });

  it("rejects complete seed reuse joined to a template opening", () => {
    expect(
      signalExpansionReviewFallback({
        classification: poetryClassification,
        expandedText:
          "空山新雨后，天气晚来秋展开后，山色先静下来。新雨把树叶洗得发亮，青石路泛着潮意，晚风从枝叶间穿过，带来一点秋天的凉。天光收得很慢，水声在空处一滴一滴，把四周衬得更远。",
        seedText: "空山新雨后，天气晚来秋",
      }),
    ).toMatchObject({
      matchesSeedType: true,
      pass: false,
      problems: expect.arrayContaining(["完整复读原句", "把原句硬接到模板开头"]),
    });
  });

  it("rejects compact oral seeds expanded into unrelated complete scenes", () => {
    const oralClassification = classifySignalSeedFallback("大家夸小王是小强棒");

    expect(
      signalExpansionReviewFallback({
        classification: oralClassification,
        expandedText:
          "小王接过同事递来的报表，顺手调正了打印机卡纸。办公室里有人笑说，这事还得靠他。他点点头，把订书机放回原位，没多说什么。茶水间里，几个人聊起上周的项目，又提到他名字。杯子里的水汽模糊了窗外的光线，他站在一边，听他们讲完，才回到座位继续处理邮件。",
        seedText: "大家夸小王是小强棒",
      }),
    ).toMatchObject({
      matchesSeedType: false,
      pass: false,
      preservesOriginalDirection: false,
      problems: expect.arrayContaining([
        "短口语原句被扩写成了外部完整场景",
        "没有保留原句的特色说法",
      ]),
    });
  });

  it("allows compact oral expansions that preserve the odd phrase", () => {
    const oralClassification = classifySignalSeedFallback("大家夸小王是小强棒");

    expect(
      signalExpansionReviewFallback({
        classification: oralClassification,
        expandedText:
          "大家夸小王是小强棒，这句话听起来有点拧巴，却很像现场冒出来的真心话。它没有把意思修得太标准，只把那种笨拙的肯定留住了。小王听见后先愣了一下，嘴角很快松开，像被一个奇怪但认真的称呼轻轻拍了拍肩。",
        seedText: "大家夸小王是小强棒",
      }),
    ).toMatchObject({
      matchesSeedType: true,
      pass: true,
      preservesOriginalDirection: true,
    });
  });

  it("varies local signal expansion fallback structure deterministically", () => {
    const first = signalExpansionFallback({
      classification: foodClassification,
      seedText: "今晚想把这段匿名信号留在这里，等一个同频的人。",
    });
    const second = signalExpansionFallback({
      classification: {
        ...foodClassification,
        keywords: ["糖醋排骨", "米饭", "酱汁"],
      },
      seedText: "我想吃糖醋排骨",
    });

    expect(first.expandedText).not.toBe(second.expandedText);
    expect(first.expandedText).not.toContain("我把这句话留在心里");
    expect(second.expandedText).not.toContain("我把这句话留在心里");
  });

  it("keeps short-seed local signal expansion fallback within schema length", () => {
    const result = signalExpansionFallback({
      classification: foodClassification,
      seedText: "sekai..",
    });

    expect(result.expandedText.length).toBeGreaterThanOrEqual(80);
    expect(result.expandedText.length).toBeLessThanOrEqual(180);
    expect(result.expandedText).not.toContain("我把这句话留在心里");
  });

  it("rejects generic AI-style signal quality in local fallback", () => {
    expect(
      signalQualityFallback({
        content: "我想被看见，也想和自己和解，真正重要的不是答案，而是允许自己慢下来。",
      }),
    ).toMatchObject({
      score: 2,
    });

    expect(
      signalQualityFallback({
        content: "我在末班地铁把那句话删掉，怕一发出去，就再也装不了平静，只好继续站着。",
      }).score,
    ).toBeGreaterThanOrEqual(4);
  });
});
