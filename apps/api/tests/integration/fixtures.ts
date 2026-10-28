import type {
  AiSignalExpansion,
  AiSignalExpansionReview,
  AiSignalFingerprint,
  AiSignalMaterial,
  AiSignalSeedClassification,
} from "../../src/modules/ai/signal-types.js";

// Entirely synthetic: no imported accounts, personal text or production data.
export const fixtureSeed = "今天完成一页练习后，我想在窗边停一会儿。";

export const fixtureClassification: AiSignalSeedClassification = {
  allowedInventions: ["纸张的位置", "窗边的日光", "短暂的停顿"],
  confidence: 0.95,
  energy: "low",
  expansionMode: "light_scene",
  forbiddenInventions: ["人物经历", "心理诊断"],
  inputKind: "wish",
  intendedFocus: "完成练习后在窗边短暂停留",
  inventionLevel: "low",
  keywords: ["练习纸", "窗边", "停顿"],
  mood: "平静",
  mustAvoid: ["诊断", "强制负面情绪"],
  preserve: ["练习", "窗边", "停一会儿"],
  sceneHint: "纸张放到一旁，视线转向窗边",
  shouldBeNegative: false,
  type: "daily_wish",
  userAct: "make_wish",
};

export const fixtureExpansion: AiSignalExpansion = {
  expandedText: "练习纸上的最后一道题已经写完，铅笔横放在页脚。我把纸往旁边推开一点，转向窗边，让视线离开那些密密的数字。玻璃上有一小块日光，楼下传来几声脚步，停下来的一会儿也有自己的节奏。等那阵声音过去，我再决定下一页从哪里开始。",
  followUpQuestion: "你想在窗边停留多久？",
};

export const fixtureFingerprint: AiSignalFingerprint = {
  coreNeed: "给自己保留短暂停顿",
  displayText: "自我镜像 · 自我接纳",
  energy: 0.3,
  emotionTone: "平静",
  frequency: "SIG-INTEGRATION",
  hiddenNeed: "给自己保留短暂停顿",
  innerConflict: "还想继续练习，也愿意允许自己暂停",
  narrativeConflict: "还想继续练习，也愿意允许自己暂停",
  openness: 0.7,
  primaryEmotion: "自我接纳",
  primaryBand: "self_mirror",
  resonanceKeywords: ["练习", "窗边", "停顿"],
  riskLevel: "LOW",
  secondaryEmotions: ["平静"],
  signalType: "self_mirror",
  subFeeling: "self_acceptance",
  tags: ["练习", "停顿"],
  theme: "自我镜像",
  title: "完成一页之后",
};

export const fixtureReview: AiSignalExpansionReview = {
  hasConcreteObjects: true,
  hasSensoryDetails: true,
  isForcedNegative: false,
  isGenericLiteraryTemplate: false,
  matchesSeedType: true,
  pass: true,
  preservesOriginalDirection: true,
  problems: [],
  rewriteInstruction: "",
  score: 9,
};

export const fixtureMaterial: AiSignalMaterial = {
  classification: fixtureClassification,
  expansion: fixtureExpansion,
  fingerprint: fixtureFingerprint,
};
