import { signalExpansionBlockedPhrases } from "./provider-prompts.js";
import { callChatProvider } from "./provider-transport.js";
import { evaluateSignalQuality } from "./signal-quality-evaluator.js";
import {
  getSignalFrequencyDisplayText,
  normalizeSignalFrequencyProfile,
  signalBandLabels,
} from "../signals/frequency-taxonomy.js";
import type {
  AiClassification,
  AiContentAnalysis,
  AiEchoSuggestion,
  AiModeration,
  AiTagSuggestion,
} from "./legacy-types.js";
import type {
  AiMonthlyRecap,
  AiSignalFingerprint,
  AiSignalContent,
  AiSignalContentInput,
  AiSignalExpansion,
  AiSignalExpansionReview,
  AiSignalExpansionReviewInput,
  AiSignalExpansionInput,
  AiSignalProgram,
  AiSignalMaterial,
  AiSignalProgramInput,
  AiSignalQuality,
  AiSignalQualityInput,
  AiSignalSeedClassification,
  AiSignalSeedType,
} from "./signal-types.js";


export function classifyFallback(content: string): AiClassification {
  const lower = content.toLowerCase();

  if (lower.includes("凌晨") || lower.includes("深夜") || lower.includes("夜")) {
    return { channel: "MIDNIGHT", confidence: 0.84, reason: "内容更像夜间倾诉。" };
  }

  if (lower.includes("给你") || lower.includes("没说出口") || lower.includes("未送达")) {
    return { channel: "UNSENT", confidence: 0.82, reason: "内容更像未送达的表达。" };
  }

  return { channel: "STARMAP", confidence: 0.68, reason: "内容更适合进入星图沉淀。" };
}

export function tagsFallback(content: string): AiTagSuggestion {
  const base = new Set<string>();
  const text = content.toLowerCase();

  if (text.includes("孤独")) base.add("孤独");
  if (text.includes("想念")) base.add("想念");
  if (text.includes("压力")) base.add("压力");
  if (text.includes("焦虑")) base.add("焦虑");
  if (text.includes("开心")) base.add("开心");
  if (base.size === 0) {
    base.add("迷茫");
    base.add("夜晚");
  }

  return { tags: Array.from(base).slice(0, 5) };
}

export function moderateFallback(content: string): AiModeration {
  const lower = content.toLowerCase();

  if (lower.includes("诈骗") || lower.includes("广告") || lower.includes("引流")) {
    return { action: "HIDE", reason: "内容带有明显风险信号。", riskLevel: "HIGH" };
  }

  if (lower.includes("隐私") || lower.includes("威胁") || lower.includes("辱骂")) {
    return { action: "REVIEW", reason: "内容需要人工确认。", riskLevel: "MEDIUM" };
  }

  return { action: "ALLOW", reason: "未发现明显风险信号。", riskLevel: "LOW" };
}

export function contentAnalysisFallback(content: string): AiContentAnalysis {
  const tags = tagsFallback(content).tags;
  const moderation = moderateFallback(content);
  const lower = content.toLowerCase();
  const hasStrongEmotion =
    lower.includes("崩溃") ||
    lower.includes("难受") ||
    lower.includes("焦虑") ||
    lower.includes("孤独");
  const summary = content.length > 60 ? `${content.slice(0, 60)}...` : content;

  return {
    emotions: tags.slice(0, 4),
    intensity: moderation.riskLevel === "HIGH" ? 0.86 : hasStrongEmotion ? 0.72 : 0.48,
    keywords: tags.slice(0, 6),
    reason: moderation.reason,
    riskLevel: moderation.riskLevel,
    summary,
  };
}

export function monthlyRecapFallback(content: string): AiMonthlyRecap {
  const tags = tagsFallback(content).tags.slice(0, 3);
  const themeWords = tags.length === 0 ? ["日常"] : tags;

  return {
    summary: `这个月的信号反复靠近${themeWords.join("、")}。它们没有急着给答案，只把一些难说的话留了下来。`.slice(0, 100),
    themeWords,
  };
}

export function echoFallback(content: string): AiEchoSuggestion {
  return {
    suggestion: `可以回应：${content.slice(0, 60)}`,
  };
}

function toShortText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function toSignalHash(rawInput: string): string {
  let hash = 0;

  for (let index = 0; index < rawInput.length; index += 1) {
    hash = (hash * 31 + rawInput.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(6, "0").slice(0, 6).toUpperCase();
}

function extractSignalTags(rawInput: string): string[] {
  const tags = tagsFallback(rawInput).tags;
  const words = rawInput.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const uniqueTags = new Set<string>(tags);

  for (const word of words) {
    uniqueTags.add(word.toLowerCase());
  }

  return Array.from(uniqueTags).slice(0, 8);
}

export function signalFingerprintFallback(content: string): AiSignalFingerprint {
  const compactContent = content.trim();
  const analysis = contentAnalysisFallback(compactContent);
  const tags = extractSignalTags(compactContent);
  const primaryEmotion = analysis.emotions[0] ?? "未命名情绪";
  const profile = normalizeSignalFrequencyProfile({
    coreNeed: "确认自己的感受能被理解",
    emotionTone: primaryEmotion,
    fallbackText: compactContent,
    innerConflict: "想继续往前，又怀疑自己是否真的被看见",
    resonanceKeywords: tags,
  });

  return {
    coreNeed: profile.coreNeed,
    displayText: getSignalFrequencyDisplayText(profile.primaryBand, profile.subFeeling),
    energy: analysis.intensity,
    emotionTone: profile.emotionTone,
    frequency: `SIG-${toSignalHash(compactContent)}`,
    hiddenNeed: profile.coreNeed,
    innerConflict: profile.innerConflict,
    narrativeConflict: "想靠近别人，又担心自己的情绪打扰别人",
    openness: Math.min(1, Math.max(0.35, compactContent.length / 600)),
    primaryEmotion,
    primaryBand: profile.primaryBand,
    resonanceKeywords: profile.resonanceKeywords,
    riskLevel: analysis.riskLevel,
    secondaryEmotions: analysis.emotions.filter((emotion) => emotion !== primaryEmotion).slice(0, 4),
    signalType: profile.primaryBand,
    subFeeling: profile.subFeeling,
    tags: profile.resonanceKeywords,
    theme: signalBandLabels[profile.primaryBand],
    title: toShortText(compactContent, 24),
  };
}

export function signalProgramFallback(input: AiSignalProgramInput): AiSignalProgram {
  const leftSummary = toShortText(input.rawInput, 96);
  const matchSummary = input.match?.summary;

  return {
    bridgeNarration:
      matchSummary === undefined
        ? "这段信号暂时独自播放，等待下一段同频回应。"
        : "两段信号没有互相解释，却在相近的情绪里短暂停靠。",
    closingQuestion:
      matchSummary === undefined
        ? "如果有人在相近的夜里听见，他会怎么回应？"
        : "你愿意把这段同频继续留在这里吗？",
    hostIntro: `这里是 ${input.fingerprint.frequency}，收到一段新的匿名信号。`,
    leftSignalSummary: leftSummary,
    programTitle: `${input.fingerprint.title} / 同频试播`,
    ...(matchSummary === undefined ? {} : { rightSignalSummary: matchSummary }),
    shareQuote: `我在 ${input.fingerprint.frequency} 留下了一段信号。`,
  };
}

function redactSensitiveSignalText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "某个联系方式")
    .replace(/1[3-9]\d{9}/gu, "某个号码")
    .replace(/微信[:：]?\s*[\w-]{3,}/giu, "某个联系方式")
    .trim();
}

const fallbackExpansionDetails = [
  {
    followUpQuestion: "你最近把哪句话留在了原地？",
    gesture: "我把杯沿转了一圈，又停住",
    scene: "屏幕暗下去的时候，房间里只剩空调细小的声响",
    tail: "杯底在桌面上留下一圈水印，我看了很久",
  },
  {
    followUpQuestion: "你最近哪一刻忽然不想解释了？",
    gesture: "我把那条消息删掉，手指还停在键盘上",
    scene: "走廊的灯亮着，门缝里漏出一点低低的说话声",
    tail: "输入框空下来，屏幕上的光贴着指节，没有再跳",
  },
  {
    followUpQuestion: "你最近在哪里听见过自己的停顿？",
    gesture: "我把外套搭回椅背，口袋里的钥匙轻轻响了一下",
    scene: "窗外车声慢下来，桌面还摊着没收好的纸",
    tail: "那声响很短，纸页边角被风掀起一点，又落回去",
  },
  {
    followUpQuestion: "你最近在哪个小动作里停住了？",
    gesture: "我把手机翻过去，又忍不住看了一眼通知栏",
    scene: "水杯旁边压着一张没写完的便签",
    tail: "便签纸卷着边，像还有半句话没找到地方放",
  },
  {
    followUpQuestion: "你最近哪句话差点就说出口了？",
    gesture: "我把灯关掉，又在黑里站了几秒",
    scene: "门口的鞋尖还朝着外面",
    tail: "鞋带松了一截，我蹲下去重新系，却忘了先开灯",
  },
];

const fallbackExpansionTemplates = [
  (seedFragment: string, detail: (typeof fallbackExpansionDetails)[number]) =>
    `${detail.scene}，${detail.gesture}。${seedFragment}从刚才起一直贴在旁边，没有变成一句完整的话。${detail.tail}。`,
  (seedFragment: string, detail: (typeof fallbackExpansionDetails)[number]) =>
    `${seedFragment}。它冒出来的时候，${detail.scene}。${detail.gesture}，动作很小，像怕碰到什么。屋子里没有人问，${detail.tail}。`,
  (seedFragment: string, detail: (typeof fallbackExpansionDetails)[number]) =>
    `${detail.gesture}的时候，我又想起${seedFragment}。${detail.scene}，周围没有谁追问，那点没说完的东西只在手边停着。${detail.tail}。`,
  (seedFragment: string, detail: (typeof fallbackExpansionDetails)[number]) =>
    `我没有把${seedFragment}讲完整，只是在${detail.scene}的时候停了一下。${detail.gesture}，剩下的话挤在喉咙后面，没有往外走。${detail.tail}。`,
];

const fallbackExpansionLengthPad = "我把手收回来，指尖还停着一点凉。";

function ensureFallbackExpansionLength(text: string): string {
  if (text.length >= 80) {
    return text;
  }

  return `${text}${fallbackExpansionLengthPad}`;
}

function getFallbackIndex(key: string, length: number): number {
  return Number.parseInt(toSignalHash(key).slice(0, 2), 16) % length;
}

type TypedFallbackExpansionTemplate = (seedFragment: string) => AiSignalExpansion;

const typedFallbackExpansionTemplates: Partial<
  Record<AiSignalSeedType, TypedFallbackExpansionTemplate[]>
> = {
  absurd: [
    (seedFragment) => ({
      expandedText: `${seedFragment}像一张突然打开的怪天气预报。电线杆先打了个哈欠，便利店门口的影子慢半拍跟上来，路过的人都假装没看见。荒诞的部分没有被解释，它只是站在街角，认真地把今天变得不太一样。`,
      followUpQuestion: "它还会变成什么？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}落到现实里时，现实明显愣了一下。钟表继续走，路牌却像在改主意，风把一张传单吹得绕了三圈。没有人急着纠正它，奇怪反而有了自己的秩序，像一场只持续几分钟的小型魔术。`,
      followUpQuestion: "谁先发现它？",
    }),
  ],
  daily_wish: [
    (seedFragment) => ({
      expandedText: `${seedFragment}先出现在一个普通的间隙里。窗边有晒过的衣服，桌上还放着没合上的本子，水壶咕嘟响了一声。愿望不需要立刻变大，它只是把今天往前推了一小步，让人想把手里的事做完，再去靠近一点。`,
      followUpQuestion: "它发生在哪一刻？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}像贴在日程边上的一张小纸条。外面的光慢慢移到桌角，鞋子已经摆到门口，钥匙在包里轻轻碰了一下。没有宏大的理由，只是这一刻忽然想把生活调亮一点，顺手给自己留个出口。`,
      followUpQuestion: "你想从哪里开始？",
    }),
  ],
  food: [
    (seedFragment) => ({
      expandedText: `${seedFragment}这念头一冒出来，锅里的酱汁像已经在冒泡。排骨裹着红亮的糖醋汁，筷子一碰就沾住一点酸甜香气。米饭盛在旁边，厨房门口有人探头催菜，热气往桌边散，连盘沿都像在等第一口。`,
      followUpQuestion: "第一口想给谁？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}不只是想法，更像饭点前的香气先绕了过来。油光贴在排骨边缘，糖醋汁慢慢收浓，铲子翻动时发出轻响。碗里的白米饭已经盛好，只差那一勺亮晶晶的酱汁落下去。`,
      followUpQuestion: "你想配什么吃？",
    }),
  ],
  emotion: [
    (seedFragment) => ({
      expandedText: `${seedFragment}停在聊天框上方，光把手指照得很白。那句晚安隔了很久才出现，语气比从前轻了一截。没有人把答案讲明，可每一次避开的眼神、每一次突然变短的回复，都把差别一点点摆到桌面上。`,
      followUpQuestion: "差别先从哪来？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}不是忽然冒出来的判断。电梯镜面里两个人并排站着，肩膀之间空出一小段距离，手机通知亮了又暗。真正明显的，是对方伸手前那半秒迟疑，还有话说到一半时先收回去的眼神。`,
      followUpQuestion: "你先看见哪一秒？",
    }),
  ],
  memory: [
    (seedFragment) => ({
      expandedText: `${seedFragment}被想起时，画面先回来。旧椅子的边角有一点磨痕，窗帘被风推开半寸，某个熟悉的声音停在门口。回忆没有把人拉远，只是把一小段时间重新摆到眼前，让细节自己发亮。`,
      followUpQuestion: "你先想起了谁？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}像从抽屉深处翻出来的一张票根。纸边已经软了，字迹却还认得出，连当时路上的光和脚步声都跟着回来。那不是一整段过去，只是一枚小小的钩子，把某天重新挂在眼前。`,
      followUpQuestion: "那天是什么天气？",
    }),
  ],
  observation: [
    (seedFragment) => ({
      expandedText: `${seedFragment}落在办公桌上时，屏幕还亮着，待办事项排成一列。人有时不是事情太多，而是不敢让桌面空下来。因为一旦手停住，真正追上来的就不是时间，而是那个一直没回答的问题。`,
      followUpQuestion: "哪个画面最像它？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}像电梯门合上前的一秒。每个人都低头看着自己的屏幕，数字一层层往上跳，谁也没有多说。观察突然变得锋利，不是因为它吓人，而是因为它太像每天都会经过的地方。`,
      followUpQuestion: "你在哪里看见它？",
    }),
  ],
  poetry: [
    (seedFragment) => ({
      expandedText: `${seedFragment}像一层薄薄的湿意落在山间。石阶被雨水洗亮，松针上挂着细小水珠，风从空谷里穿过来，带一点晚秋的凉。远处没有杂声，只有水沿着岩缝慢慢滴下去，把傍晚的光也放得很轻。`,
      followUpQuestion: "画面里还有什么？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}展开后，山色先静下来。新雨把树叶洗得发亮，青石路泛着潮意，晚风从枝叶间穿过，带来一点秋天的凉。天光收得很慢，水声在空处一滴一滴，把四周衬得更远。`,
      followUpQuestion: "你听见了什么？",
    }),
  ],
  question: [
    (seedFragment) => ({
      expandedText: `${seedFragment}停在嘴边时，周围的动作还在继续。电梯到站，门开了又合上，手里的纸袋轻轻晃了一下。问题没有急着要回应，它只是把一个普通瞬间按慢，让人看清自己真正想问的那一层。`,
      followUpQuestion: "它最想问谁？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}像一枚小石子落进水里。桌面上的笔滚了一下，窗外有人经过，脚步声很快消失。问题没有变成道理，只留下几圈清晰的波纹，让人知道这里确实被碰了一下。`,
      followUpQuestion: "它从哪件事来？",
    }),
  ],
  sports: [
    (seedFragment) => ({
      expandedText: `${seedFragment}一喊出来，场边先热起来。有人从器材袋里抽出球棒，有人压着帽檐往本垒跑，鞋底擦过土面带起一点灰。球还没飞出去，笑声已经绕着场地滚了一圈，比分暂时不重要，大家只是想借这个理由动起来。`,
      followUpQuestion: "谁会先跑起来？",
    }),
    (seedFragment) => ({
      expandedText: `${seedFragment}像哨声一样把人叫到场上。手套被拍了两下，球在掌心里转了一圈，几个原本说不会的人已经站到边线外。风把喊声推开，脚步很快接上，热闹先于比分开始。`,
      followUpQuestion: "你站在哪个位置？",
    }),
  ],
};

function buildTypedFallbackExpansion(input: {
  fallbackKey: string;
  seedFragment: string;
  type: AiSignalSeedType;
}): AiSignalExpansion | undefined {
  const templates = typedFallbackExpansionTemplates[input.type];

  if (templates === undefined || templates.length === 0) {
    return undefined;
  }

  const template = templates[getFallbackIndex(`${input.fallbackKey}:${input.type}`, templates.length)];
  const expansion = template(input.seedFragment);

  return {
    ...expansion,
    expandedText: ensureFallbackExpansionLength(expansion.expandedText),
  };
}

export function signalExpansionFallback(input: AiSignalExpansionInput): AiSignalExpansion {
  const compactSeed = redactSensitiveSignalText(input.seedText).replace(/\s+/gu, "");
  const seedFragment = compactSeed.length > 34 ? compactSeed.slice(0, 34) : compactSeed;
  const fallbackType = inferExpansionSeedType(input.seedText, input.classification);
  const fallbackKey = [
    compactSeed,
    fallbackType,
    input.classification.expansionMode,
    input.classification.keywords.join("|"),
  ].join(":");
  const typedExpansion = buildTypedFallbackExpansion({
    fallbackKey,
    seedFragment,
    type: fallbackType,
  });

  if (typedExpansion !== undefined) {
    return typedExpansion;
  }

  const detail = fallbackExpansionDetails[getFallbackIndex(fallbackKey, fallbackExpansionDetails.length)];
  const template = fallbackExpansionTemplates[
    getFallbackIndex(`${fallbackKey}:template`, fallbackExpansionTemplates.length)
  ];

  return {
    expandedText: ensureFallbackExpansionLength(template(seedFragment, detail)),
    followUpQuestion: detail.followUpQuestion,
  };
}

const fallbackContentDetails = [
  {
    gesture: "把那句话删掉",
    tail: "怕它一发出去，就再也装不了平静",
  },
  {
    gesture: "盯着屏幕亮了又暗",
    tail: "怕一开口，别人只听见我在麻烦他们",
  },
  {
    gesture: "把手里的东西放下又拿起",
    tail: "怕自己其实已经撑不住，只是还没人发现",
  },
];

export function signalContentFallback(input: AiSignalContentInput): AiSignalContent {
  const scene = input.commonScenes[0] ?? "普通的一天";
  const concern = input.currentConcern.replace(/[。.!！?？]+$/u, "");
  const detail = fallbackContentDetails[
    getFallbackIndex(`${input.fmName}:${input.currentConcern}`, fallbackContentDetails.length)
  ];
  const content = `我在${scene}${detail.gesture}，想说${concern}，又${detail.tail}。`;

  return {
    rawInput: toShortText(content, 100),
  };
}

export function signalQualityFallback(input: AiSignalQualityInput): AiSignalQuality {
  const evaluation = evaluateSignalQuality(input.content);

  return {
    reason: evaluation.reason,
    score: evaluation.score,
  };
}

function includesAny(content: string, keywords: string[]): boolean {
  return keywords.some((keyword) => content.includes(keyword));
}

function toCompactSignalText(content: string): string {
  return content.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function extractSemanticChunks(content: string): string[] {
  return content.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

function isCompactOralSeed(content: string): boolean {
  const compactContent = content.trim();
  const chunks = extractSemanticChunks(compactContent);

  return (
    compactContent.length > 0 &&
    compactContent.length <= 18 &&
    !/[?？。.!！]/u.test(compactContent) &&
    chunks.length <= 3
  );
}

function getDistinctiveSeedAnchors(seedText: string, preserveItems: string[]): string[] {
  const seedChunks = extractSemanticChunks(seedText);
  const anchors = new Set<string>();

  for (const item of preserveItems) {
    if (item.trim().length >= 2) {
      anchors.add(item.trim());
    }
  }

  for (const chunk of seedChunks) {
    if (chunk.length >= 3 || seedChunks.length <= 2) {
      anchors.add(chunk);
    }
  }

  if (isCompactOralSeed(seedText)) {
    const compactSeed = seedText.trim();

    if (compactSeed.length >= 4) {
      anchors.add(compactSeed);
    }
  }

  return Array.from(anchors);
}

function hasDistinctiveSeedAnchor(params: {
  expandedText: string;
  preserveItems: string[];
  seedText: string;
}): boolean {
  const anchors = getDistinctiveSeedAnchors(params.seedText, params.preserveItems);
  const minimumAnchorLength = isCompactOralSeed(params.seedText) ? 3 : 2;

  if (anchors.length === 0) {
    return true;
  }

  const compactExpansion = toCompactSignalText(params.expandedText);

  return anchors.some((anchor) => {
    const compactAnchor = toCompactSignalText(anchor);

    return compactAnchor.length >= minimumAnchorLength && compactExpansion.includes(compactAnchor);
  });
}

function hasCompactSeedExternalSceneDrift(seedText: string, expandedText: string): boolean {
  if (!isCompactOralSeed(seedText)) {
    return false;
  }

  const externalSceneWords = [
    "办公室",
    "同事",
    "报表",
    "打印机",
    "项目",
    "邮件",
    "茶水间",
    "会议",
    "老板",
    "学校",
    "老师",
    "教室",
    "厨房",
    "餐桌",
    "聊天框",
    "电梯",
  ];
  const sceneHitCount = externalSceneWords.filter((word) => expandedText.includes(word)).length;

  return sceneHitCount >= 2;
}

const foodSceneWords = [
  "厨房",
  "锅",
  "饭",
  "菜",
  "汤",
  "粥",
  "碗",
  "筷",
  "勺",
  "盘",
  "红糖",
  "姜丝",
  "红枣",
  "酱汁",
  "排骨",
  "米饭",
  "食物",
  "饭菜",
  "吃",
  "煮",
  "炒",
  "炖",
  "端来",
  "盛饭",
  "餐桌",
  "香味",
];

const foodSeedWords = [
  "吃",
  "饿",
  "馋",
  "喝",
  "饭",
  "菜",
  "餐",
  "锅",
  "碗",
  "筷",
  "厨房",
  "糖醋",
  "排骨",
  "火锅",
  "面",
  "咖啡",
  "奶茶",
  "蛋糕",
  "红糖",
  "姜",
  "红枣",
  "温水",
  "杯水",
  "饮料",
  "夜宵",
  "食堂",
  "小吃",
  "烧烤",
];

const foodCareSceneWords = [
  "温水",
  "热水",
  "水杯",
  "杯壁",
  "红糖",
  "姜丝",
  "红枣",
];

const careActionWords = [
  "递来",
  "端来",
  "推回",
  "试了温度",
  "照料",
  "喂",
  "盛",
];

const emotionSeedWords = [
  "不爱",
  "喜欢",
  "想念",
  "关系",
  "恋爱",
  "分手",
  "冷淡",
  "在乎",
  "失望",
  "心动",
  "难过",
];

const sportsSeedWords = [
  "球",
  "跑",
  "比赛",
  "运动",
  "垒球",
  "篮球",
  "足球",
  "加油",
];

const poetrySeedWords = [
  "山",
  "雨",
  "秋",
  "春",
  "风",
  "云",
  "月",
  "雪",
  "松",
  "江",
];

const modernObjectWords = [
  "手机",
  "屏幕",
  "键盘",
  "电梯",
  "汽车",
  "咖啡",
  "冰箱",
  "便利店",
  "聊天框",
  "通知",
];

const inventedCharacterWords = [
  "他",
  "她",
  "有人",
  "两个人",
  "对方",
  "朋友",
  "恋人",
  "同事",
];

const fullPlotWords = [
  "后来",
  "终于",
  "从此",
  "故事",
  "结局",
  "剧情",
  "整晚",
  "一整天",
];

function hasEmotionSeedCue(content: string): boolean {
  return (
    includesAny(content, emotionSeedWords) ||
    /(?:爱与|我爱|爱你|爱他|爱她|爱过|被爱|相爱|去爱)/u.test(content)
  );
}

function inferExpansionSeedType(
  seedText: string,
  classification: AiSignalSeedClassification,
): AiSignalSeedType {
  const content = seedText.trim();
  const classificationHint = [
    classification.intendedFocus ?? "",
    classification.keywords.join("、"),
    classification.preserve?.join("、") ?? "",
  ].join("、");

  if (includesAny(content, foodSeedWords)) {
    return "food";
  }

  if (includesAny(content, sportsSeedWords)) {
    return "sports";
  }

  if (includesAny(content, poetrySeedWords)) {
    return "poetry";
  }

  if (/[?？]$/u.test(content)) {
    return "question";
  }

  if (hasEmotionSeedCue(`${content}、${classificationHint}`)) {
    return "emotion";
  }

  if (classification.type === "food") {
    return "unknown";
  }

  return classification.type;
}

function hasClassicPoemShape(content: string): boolean {
  const normalized = content.replace(/[，。！？、,.!?;；:\s]/gu, "");

  return (
    content.includes("，") &&
    normalized.length >= 8 &&
    normalized.length <= 20 &&
    includesAny(content, poetrySeedWords)
  );
}

function normalizeTextForReuseCheck(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function hasCompleteSeedReuse(seedText: string, expandedText: string): boolean {
  const normalizedSeed = normalizeTextForReuseCheck(seedText);

  return (
    normalizedSeed.length >= 6 &&
    normalizeTextForReuseCheck(expandedText).includes(normalizedSeed)
  );
}

function hasSeedHardJoin(seedText: string, expandedText: string): boolean {
  const trimmedSeed = seedText.trim();
  const trimmedExpandedText = expandedText.trim();

  if (trimmedSeed.length === 0 || !trimmedExpandedText.startsWith(trimmedSeed)) {
    return false;
  }

  const remainingText = trimmedExpandedText.slice(trimmedSeed.length).trimStart();

  return /^(?:展开后|像|是|落到|先|这念头|不只是|被|停在|时)/u.test(remainingText);
}

function hasForbiddenExpansionRule(input: AiSignalExpansionReviewInput): boolean {
  const forbiddenRules = [
    ...(input.classification.mustAvoid ?? []),
    ...(input.classification.forbiddenInventions ?? []),
  ];

  return forbiddenRules.some((rule) => {
    const normalizedRule = rule.trim();

    if (normalizedRule.length === 0) {
      return false;
    }

    if (normalizedRule.includes("现代物件")) {
      return includesAny(input.expandedText, modernObjectWords);
    }

    if (normalizedRule.includes("剧情化人物")) {
      return includesAny(input.expandedText, inventedCharacterWords) && includesAny(input.expandedText, fullPlotWords);
    }

    if (normalizedRule === "人物" || normalizedRule.includes("新增人物") || normalizedRule.includes("角色")) {
      return includesAny(input.expandedText, inventedCharacterWords);
    }

    if (normalizedRule.includes("完整剧情") || normalizedRule.includes("剧情")) {
      return includesAny(input.expandedText, fullPlotWords);
    }

    if (normalizedRule.includes("人生哲理") || normalizedRule.includes("人生总结")) {
      return includesAny(input.expandedText, ["人生", "生活", "意义", "答案", "道理", "成长"]);
    }

    return normalizedRule
      .split(/[、,，/／|｜\s]+/u)
      .map((part) => part.trim())
      .some((part) => {
        return part.length > 0 && input.expandedText.includes(part) && !input.seedText.includes(part);
      });
  });
}

function extractSeedKeywords(content: string, fallbackKeywords: string[]): string[] {
  const words = content.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const keywords = new Set<string>(fallbackKeywords);

  for (const word of words) {
    keywords.add(word.toLowerCase());
  }

  return Array.from(keywords).slice(0, 8);
}

function buildFallbackSeedClassification(
  input: Pick<
    AiSignalSeedClassification,
    "energy" | "expansionMode" | "keywords" | "mood" | "shouldBeNegative" | "type"
  > &
    Partial<
      Pick<
        AiSignalSeedClassification,
        | "allowedInventions"
        | "confidence"
        | "forbiddenInventions"
        | "inputKind"
        | "intendedFocus"
        | "inventionLevel"
        | "mustAvoid"
        | "preserve"
        | "sceneHint"
        | "userAct"
      >
    >,
): AiSignalSeedClassification {
  const preserve = input.preserve ?? input.keywords.slice(0, 4);
  const intendedFocus = input.intendedFocus ?? preserve.join("、");
  const mustAvoid = input.mustAvoid ?? input.forbiddenInventions ?? [];
  const forbiddenInventions = input.forbiddenInventions ?? mustAvoid;

  return {
    ...input,
    allowedInventions: input.allowedInventions ?? [],
    confidence: input.confidence ?? 0.65,
    forbiddenInventions,
    inputKind: input.inputKind ?? "fragment",
    intendedFocus,
    inventionLevel: input.inventionLevel ?? "medium",
    mustAvoid,
    preserve,
    sceneHint: input.sceneHint ?? intendedFocus,
    userAct: input.userAct ?? "record_fragment",
  };
}

export function classifySignalSeedFallback(seedText: string): AiSignalSeedClassification {
  const content = seedText.trim();
  const lower = content.toLowerCase();
  const negativeWords = ["孤独", "难过", "痛苦", "崩溃", "焦虑", "遗憾", "疲惫", "想哭", "失去"];
  const shouldBeNegative = includesAny(content, negativeWords);

  if (includesAny(content, ["吃", "饭", "糖醋", "排骨", "火锅", "面", "咖啡", "奶茶", "蛋糕"])) {
    return buildFallbackSeedClassification({
      allowedInventions: ["食物颜色", "气味", "口感", "餐桌动作"],
      confidence: 0.82,
      energy: "medium",
      expansionMode: "light_scene",
      inputKind: "wish",
      inventionLevel: "medium",
      keywords: extractSeedKeywords(content, ["食物", "香气", "口感"]),
      mood: "warm",
      sceneHint: "围绕具体食物、气味、口感或餐桌动作展开",
      shouldBeNegative: false,
      type: "food",
      userAct: "make_wish",
    });
  }

  if (includesAny(content, sportsSeedWords)) {
    return buildFallbackSeedClassification({
      allowedInventions: ["场地", "身体动作", "人群声音", "运动节奏"],
      confidence: 0.82,
      energy: "high",
      expansionMode: "light_scene",
      inputKind: "wish",
      inventionLevel: "medium",
      keywords: extractSeedKeywords(content, ["运动", "人群", "节奏"]),
      mood: "lively",
      sceneHint: "围绕场地、身体动作、节奏和人群声音展开",
      shouldBeNegative: false,
      type: "sports",
      userAct: "invite",
    });
  }

  if (includesAny(content, poetrySeedWords)) {
    return buildFallbackSeedClassification({
      allowedInventions: ["空气", "光线", "水声", "季节触感"],
      confidence: hasClassicPoemShape(content) ? 0.84 : 0.72,
      energy: "low",
      expansionMode: hasClassicPoemShape(content) ? "aftertaste" : "continue_image",
      forbiddenInventions: ["人物", "现代物件", "完整剧情", "解释诗句"],
      inputKind: hasClassicPoemShape(content) ? "classic_poem" : "quote",
      inventionLevel: hasClassicPoemShape(content) ? "none" : "low",
      keywords: extractSeedKeywords(content, ["景物", "季节", "空气"]),
      mood: "quiet",
      sceneHint: "围绕自然景物、季节、空气和声音展开",
      shouldBeNegative,
      type: "poetry",
      userAct: "quote_for_aftertaste",
    });
  }

  if (/[?？]$/u.test(content)) {
    return buildFallbackSeedClassification({
      allowedInventions: ["问题前后的停顿", "一个小动作"],
      confidence: 0.76,
      energy: shouldBeNegative ? "low" : "medium",
      expansionMode: "ask_detail",
      inputKind: "question",
      inventionLevel: "low",
      keywords: extractSeedKeywords(content, ["问题", "停顿"]),
      mood: shouldBeNegative ? "uncertain" : "curious",
      sceneHint: "写问题出现前后的具体停顿和动作",
      shouldBeNegative,
      type: "question",
      userAct: "ask_question",
    });
  }

  if (includesAny(content, ["所有", "人生", "意义", "其实", "总是", "不敢", "面对"])) {
    return buildFallbackSeedClassification({
      allowedInventions: ["一个贴近观点的轻微画面", "语气节奏"],
      confidence: 0.74,
      energy: shouldBeNegative ? "medium" : "low",
      expansionMode: "clarify_thought",
      inputKind: "original_thought",
      inventionLevel: "low",
      keywords: extractSeedKeywords(content, ["观察", "生活"]),
      mood: shouldBeNegative ? "sharp" : "clear",
      sceneHint: "写一个承载这条观察的可见场面",
      shouldBeNegative,
      type: "observation",
      userAct: "state_opinion",
    });
  }

  if (hasEmotionSeedCue(content)) {
    return buildFallbackSeedClassification({
      allowedInventions: ["语气变化", "距离感", "停顿", "关系里的小差别"],
      confidence: 0.8,
      energy: shouldBeNegative ? "low" : "medium",
      expansionMode: "clarify_thought",
      forbiddenInventions: includesAny(content, foodSeedWords)
        ? ["完整剧情", "诊断", "人生总结"]
        : ["厨房", "做饭", "饮食照料", "剧情化人物"],
      inputKind: "original_thought",
      inventionLevel: "low",
      keywords: extractSeedKeywords(content, ["情感", "关系", "落差"]),
      mood: shouldBeNegative ? "heavy" : "clear",
      mustAvoid: includesAny(content, foodSeedWords) ? [] : ["厨房", "做饭", "饮食照料"],
      sceneHint: "写关系、语气、距离或态度变化里显出来的情感落差",
      shouldBeNegative,
      type: "emotion",
      userAct: "state_opinion",
    });
  }

  if (lower.includes("猫会说话") || includesAny(content, ["荒诞", "怪", "飞起来", "外星", "回形针", "睡觉"])) {
    return buildFallbackSeedClassification({
      allowedInventions: ["轻微拟人", "物件动作", "荒诞秩序"],
      confidence: 0.78,
      energy: "medium",
      expansionMode: "continue_image",
      forbiddenInventions: ["人生哲理", "关系解释", "心理诊断", "宏大寓意"],
      inputKind: "absurd",
      inventionLevel: "low",
      keywords: extractSeedKeywords(content, ["荒诞", "想象"]),
      mood: "playful",
      sceneHint: "保留荒诞设定，用具体动作让它成立",
      shouldBeNegative: false,
      type: "absurd",
      userAct: "record_fragment",
    });
  }

  if (includesAny(content, ["想", "希望", "今天", "明天", "周末", "出去", "睡觉"])) {
    return buildFallbackSeedClassification({
      allowedInventions: ["日常物件", "一个小动作", "时间感"],
      confidence: 0.68,
      energy: "medium",
      expansionMode: "light_scene",
      inputKind: "wish",
      inventionLevel: "medium",
      keywords: extractSeedKeywords(content, ["日常", "愿望"]),
      mood: shouldBeNegative ? "tired" : "light",
      sceneHint: "写愿望落在日常物件和小动作里的样子",
      shouldBeNegative,
      type: "daily_wish",
      userAct: "make_wish",
    });
  }

  if (isCompactOralSeed(content)) {
    return buildFallbackSeedClassification({
      allowedInventions: ["原句语气", "称呼感", "轻微反应"],
      confidence: 0.62,
      energy: shouldBeNegative ? "low" : "medium",
      expansionMode: "clarify_thought",
      forbiddenInventions: [
        "完整职场场景",
        "完整学校场景",
        "完整家庭场景",
        "新增任务",
        "把怪句改写成普通表扬",
        "人生总结",
      ],
      inputKind: "fragment",
      intendedFocus: "保留短口语原句的语气、怪异感和未修饰的意思",
      inventionLevel: "low",
      keywords: extractSeedKeywords(content, ["口语", "怪句"]),
      mood: shouldBeNegative ? "uncertain" : "oral",
      mustAvoid: [
        "完整职场场景",
        "完整学校场景",
        "完整家庭场景",
        "新增任务",
        "把怪句改写成普通表扬",
      ],
      preserve: [content],
      sceneHint: "不要补完整外部剧情，只围绕原句的语气和特殊说法轻扩",
      shouldBeNegative,
      type: shouldBeNegative ? "emotion" : "unknown",
      userAct: shouldBeNegative ? "state_feeling" : "record_fragment",
    });
  }

  return buildFallbackSeedClassification({
    allowedInventions: shouldBeNegative ? ["贴近原句的小动作"] : ["轻微画面", "语气节奏"],
    confidence: 0.5,
    energy: shouldBeNegative ? "low" : "medium",
    expansionMode: shouldBeNegative ? "clarify_thought" : "continue_image",
    forbiddenInventions: includesAny(content, foodSeedWords)
      ? ["完整剧情", "诊断", "人生总结"]
      : ["厨房", "做饭", "饮食照料", "完整剧情", "诊断", "人生总结"],
    inputKind: "fragment",
    inventionLevel: "low",
    keywords: extractSeedKeywords(content, ["信号", "日常"]),
    mood: shouldBeNegative ? "heavy" : "neutral",
    mustAvoid: includesAny(content, foodSeedWords) ? [] : ["厨房", "做饭", "饮食照料"],
    sceneHint: "保留原句里的核心意思，用一个贴近原句的小动作承载它",
    shouldBeNegative,
    type: shouldBeNegative ? "emotion" : "unknown",
    userAct: shouldBeNegative ? "state_feeling" : "record_fragment",
  });
}

export function signalExpansionReviewFallback(
  input: AiSignalExpansionReviewInput,
): AiSignalExpansionReview {
  const problems: string[] = [];
  const blocked = signalExpansionBlockedPhrases.filter((phrase) => {
    return input.expandedText.includes(phrase);
  });

  if (blocked.length > 0) {
    problems.push(`包含模板词：${blocked.slice(0, 2).join("、")}`);
  }

  const concreteObjectWords = [
    "山",
    "水",
    "雨",
    "风",
    "光",
    "树",
    "石",
    "桌",
    "碗",
    "锅",
    "筷",
    "米饭",
    "排骨",
    "酱汁",
    "球",
    "球棒",
    "手套",
    "场",
    "鞋",
    "门",
    "窗",
    "纸",
    "杯",
    "屏幕",
    "手机",
    "聊天框",
    "手指",
    "眼神",
    "通知",
    "消息",
    "键盘",
    "椅子",
    "灯",
  ];
  const sensoryWords = [
    "香",
    "酸",
    "甜",
    "热气",
    "声音",
    "响",
    "亮",
    "凉",
    "风",
    "雨",
    "光",
    "颜色",
    "红亮",
    "潮",
    "脚步",
    "笑声",
    "灰",
    "口感",
    "眼神",
    "语气",
    "触",
    "停",
    "亮",
    "暗",
  ];
  const genericTemplateWords = [
    "频率",
    "频段",
    "信号",
    "共鸣",
    "共振",
    "回响",
    "同频",
    "发射",
    "电台",
    "广播",
    "FM",
    "星河",
    "星图",
    "灵魂",
    "陌生人",
    "被理解",
    "被看见",
    "治愈",
    "宇宙",
    "人生",
  ];
  const hasConcreteObjects = includesAny(input.expandedText, concreteObjectWords);
  const hasSensoryDetails = includesAny(input.expandedText, sensoryWords);
  const allowsNonSceneMode =
    input.classification.expansionMode === "aftertaste" ||
    input.classification.expansionMode === "clarify_thought";
  const isGenericLiteraryTemplate = includesAny(input.expandedText, genericTemplateWords);
  const repeatsCompleteSeed = hasCompleteSeedReuse(input.seedText, input.expandedText);
  const joinsSeedAsTemplatePrefix = hasSeedHardJoin(input.seedText, input.expandedText);
  const isForcedNegative =
    !input.classification.shouldBeNegative &&
    includesAny(input.expandedText, ["孤独", "疲惫", "遗憾", "痛苦", "崩溃", "人生困顿"]);
  const seedHasFoodMaterial = includesAny(input.seedText, foodSeedWords);
  const preserveItems = input.classification.preserve ?? input.classification.keywords;
  const requiresCompactSeedFidelity =
    isCompactOralSeed(input.seedText) &&
    input.classification.inputKind === "fragment" &&
    input.classification.inventionLevel === "low" &&
    input.classification.type === "unknown";
  const hasFoodSceneDrift =
    !seedHasFoodMaterial &&
    (includesAny(input.expandedText, foodSceneWords) ||
      (includesAny(input.expandedText, foodCareSceneWords) &&
        includesAny(input.expandedText, careActionWords)));
  const hasExternalSceneDrift =
    requiresCompactSeedFidelity &&
    hasCompactSeedExternalSceneDrift(input.seedText, input.expandedText);
  const mustAvoidItems = input.classification.mustAvoid ?? [];
  const forbiddenItems = input.classification.forbiddenInventions ?? [];
  const intendedFocus =
    input.classification.intendedFocus ?? input.classification.keywords.join("、");
  const violatedAvoidRules = [...mustAvoidItems, ...forbiddenItems].flatMap((rule) => {
    return rule
      .split(/[、,，/／|｜\s]+/u)
      .map((part) => part.trim())
      .filter((part) => {
        return part.length > 0 && input.expandedText.includes(part) && !input.seedText.includes(part);
      });
  });
  const violatesForbiddenInventions = hasForbiddenExpansionRule(input);
  const preservesOriginalDirection =
    preserveItems.length === 0 ||
    preserveItems.some((keyword) => input.expandedText.includes(keyword));
  const hasDistinctiveAnchor = hasDistinctiveSeedAnchor({
    expandedText: input.expandedText,
    preserveItems,
    seedText: input.seedText,
  });
  const inferredSeedType = inferExpansionSeedType(input.seedText, input.classification);
  const matchesSeedType =
    inferredSeedType === "food"
      ? includesAny(input.expandedText, ["吃", "饭", "锅", "碗", "筷", "香", "味", "排骨", "酱汁"])
      : inferredSeedType === "sports"
        ? includesAny(input.expandedText, ["球", "场", "跑", "球棒", "手套", "比分", "哨声", "脚步"])
        : inferredSeedType === "poetry"
          ? preserveItems.some((keyword) => input.expandedText.includes(keyword)) ||
            includesAny(input.expandedText, ["山", "水", "雨", "风", "秋", "光", "树", "石"])
          : inferredSeedType === "emotion"
            ? preservesOriginalDirection && !hasFoodSceneDrift
            : inferredSeedType === "absurd"
              ? preservesOriginalDirection && !includesAny(input.expandedText, ["人生", "关系", "心理", "意义"])
            : preservesOriginalDirection &&
              (!requiresCompactSeedFidelity || hasDistinctiveAnchor) &&
              !hasFoodSceneDrift &&
              !hasExternalSceneDrift;

  if (!hasConcreteObjects) {
    if (!allowsNonSceneMode) {
      problems.push("缺少具体物体");
    }
  }

  if (!hasSensoryDetails) {
    if (!allowsNonSceneMode) {
      problems.push("缺少感官细节");
    }
  }

  if (
    isForcedNegative
  ) {
    problems.push("原句不负面，但扩写强行转向沉重情绪");
  }

  if (isGenericLiteraryTemplate) {
    problems.push("像通用文艺或电台模板");
  }

  if (hasFoodSceneDrift) {
    problems.push("原句未出现食物材料，但扩写写成了厨房、饮食或照料场景");
  }

  if (hasExternalSceneDrift) {
    problems.push("短口语原句被扩写成了外部完整场景");
  }

  if (repeatsCompleteSeed && !requiresCompactSeedFidelity) {
    problems.push("完整复读原句");
  }

  if (joinsSeedAsTemplatePrefix) {
    problems.push("把原句硬接到模板开头");
  }

  if (violatedAvoidRules.length > 0) {
    problems.push(`扩写包含必须避免的方向：${violatedAvoidRules.slice(0, 2).join("、")}`);
  }

  if (violatesForbiddenInventions) {
    problems.push("扩写违背了可脑补边界");
  }

  if (
    input.expandedText.length < 80 ||
    input.expandedText.length > 180
  ) {
    problems.push("长度不在 80 到 180 字之间");
  }

  if (!preservesOriginalDirection || (requiresCompactSeedFidelity && !hasDistinctiveAnchor)) {
    problems.push("没有保留原句的特色说法");
  }

  if (!matchesSeedType) {
    problems.push(`没有写出 ${inferredSeedType} 应有的具体内容`);
  }

  return {
    hasConcreteObjects,
    hasSensoryDetails,
    isForcedNegative,
    isGenericLiteraryTemplate,
    matchesSeedType,
    pass: problems.length === 0,
    preservesOriginalDirection,
    problems,
    rewriteInstruction:
      problems.length === 0
        ? ""
        : `避开这些问题：${problems.join("；")}。保留 ${preserveItems.join("、")}，围绕 ${intendedFocus} 重写。`,
    score: problems.length === 0 ? 8.5 : 4,
  };
}

export async function classifyWithProvider(content: string) {
  return callChatProvider<AiClassification>("classify", content);
}

export async function contentAnalysisWithProvider(content: string) {
  return callChatProvider<AiContentAnalysis>("content-analysis", content);
}

export async function monthlyRecapWithProvider(content: string) {
  return callChatProvider<AiMonthlyRecap>("monthly-recap", content);
}

export async function tagsWithProvider(content: string) {
  return callChatProvider<AiTagSuggestion>("tags", content);
}

export async function moderateWithProvider(content: string) {
  return callChatProvider<AiModeration>("moderate", content);
}

export async function echoSuggestionWithProvider(content: string) {
  return callChatProvider<AiEchoSuggestion>("echo-suggestion", content);
}

export async function signalFingerprintWithProvider(content: string) {
  return callChatProvider<AiSignalFingerprint>("signal-fingerprint", content);
}

export async function signalIntentAnalysisWithProvider(seedText: string) {
  return callChatProvider<AiSignalSeedClassification>("signal-intent-analysis", seedText);
}

export async function signalSeedClassificationWithProvider(seedText: string) {
  return signalIntentAnalysisWithProvider(seedText);
}

export async function signalProgramWithProvider(input: AiSignalProgramInput) {
  return callChatProvider<AiSignalProgram>("signal-program", JSON.stringify(input));
}

export async function signalExpansionWithProvider(input: AiSignalExpansionInput) {
  return callChatProvider<AiSignalExpansion>("signal-expansion", JSON.stringify(input));
}

export async function signalMaterialWithProvider(seedText: string) {
  return callChatProvider<AiSignalMaterial>("signal-material", seedText);
}

export async function signalExpansionReviewWithProvider(input: AiSignalExpansionReviewInput) {
  return callChatProvider<AiSignalExpansionReview>("signal-expansion-review", JSON.stringify(input));
}

export async function signalContentWithProvider(input: AiSignalContentInput) {
  return callChatProvider<AiSignalContent>("signal-content", JSON.stringify(input));
}

export async function signalQualityWithProvider(input: AiSignalQualityInput) {
  return callChatProvider<AiSignalQuality>("signal-quality", JSON.stringify(input));
}
