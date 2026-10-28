import type {
  SignalFrequencyProfile,
  SignalPrimaryBand,
  SignalSubFeeling,
} from "@unfreq/contracts/signals";

export const signalPrimaryBands = [
  "self_mirror",
  "emotional_undercurrent",
  "relationship_nebula",
  "time_ring",
  "meaning_deep_space",
  "stagnant_orbit",
  "era_cluster",
] as const satisfies readonly SignalPrimaryBand[];

export const signalSubFeelings = [
  "self_doubt",
  "identity_confusion",
  "self_acceptance",
  "fatigue",
  "anxiety",
  "numbness",
  "loneliness",
  "need_to_be_understood",
  "relationship_disappointment",
  "growth_anxiety",
  "nostalgia",
  "future_uncertainty",
  "effort_doubt",
  "goal_loss",
  "existential_questioning",
  "procrastination",
  "starting_difficulty",
  "fear_of_failure",
  "efficiency_anxiety",
  "work_alienation",
  "modern_loneliness",
] as const satisfies readonly SignalSubFeeling[];

export type {
  SignalFrequencyProfile,
  SignalPrimaryBand,
  SignalSubFeeling,
};

export const signalBandLabels: Record<SignalPrimaryBand, string> = {
  emotional_undercurrent: "情绪暗流",
  era_cluster: "时代星群",
  meaning_deep_space: "意义深空",
  relationship_nebula: "关系星云",
  self_mirror: "自我镜像",
  stagnant_orbit: "停滞轨道",
  time_ring: "时间星环",
};

export const signalSubFeelingLabels: Record<SignalSubFeeling, string> = {
  anxiety: "焦虑",
  efficiency_anxiety: "效率焦虑",
  effort_doubt: "努力怀疑",
  existential_questioning: "存在追问",
  fatigue: "疲惫",
  fear_of_failure: "失败恐惧",
  future_uncertainty: "未来不确定",
  goal_loss: "目标迷失",
  growth_anxiety: "成长焦虑",
  identity_confusion: "身份困惑",
  loneliness: "孤独感",
  modern_loneliness: "时代孤独",
  need_to_be_understood: "被理解需求",
  nostalgia: "怀旧",
  numbness: "麻木",
  procrastination: "拖延",
  relationship_disappointment: "关系失望",
  self_acceptance: "自我接纳",
  self_doubt: "自我怀疑",
  starting_difficulty: "启动困难",
  work_alienation: "工作异化",
};

export const signalBandSubFeelings: Record<SignalPrimaryBand, SignalSubFeeling[]> = {
  emotional_undercurrent: ["fatigue", "anxiety", "numbness"],
  era_cluster: ["efficiency_anxiety", "work_alienation", "modern_loneliness"],
  meaning_deep_space: ["effort_doubt", "goal_loss", "existential_questioning"],
  relationship_nebula: [
    "loneliness",
    "need_to_be_understood",
    "relationship_disappointment",
  ],
  self_mirror: ["self_doubt", "identity_confusion", "self_acceptance"],
  stagnant_orbit: ["procrastination", "starting_difficulty", "fear_of_failure"],
  time_ring: ["growth_anxiety", "nostalgia", "future_uncertainty"],
};

export function getSignalFrequencyDisplayText(
  primaryBand: SignalPrimaryBand,
  subFeeling: SignalSubFeeling,
): string {
  return `${signalBandLabels[primaryBand]} · ${signalSubFeelingLabels[subFeeling]}`;
}

function isSignalPrimaryBand(value: unknown): value is SignalPrimaryBand {
  return (
    typeof value === "string" &&
    signalPrimaryBands.includes(value as SignalPrimaryBand)
  );
}

function isSignalSubFeeling(value: unknown): value is SignalSubFeeling {
  return (
    typeof value === "string" &&
    signalSubFeelings.includes(value as SignalSubFeeling)
  );
}

export function normalizeSignalFrequencyProfile(input: {
  coreNeed?: string;
  displayText?: string;
  emotionTone?: string;
  fallbackText: string;
  innerConflict?: string;
  primaryBand?: unknown;
  resonanceKeywords?: unknown;
  subFeeling?: unknown;
}): SignalFrequencyProfile {
  const primaryBand = isSignalPrimaryBand(input.primaryBand)
    ? input.primaryBand
    : inferSignalPrimaryBand(input.fallbackText);
  const allowedSubFeelings = signalBandSubFeelings[primaryBand];
  const subFeeling = isSignalSubFeeling(input.subFeeling) &&
      allowedSubFeelings.includes(input.subFeeling)
    ? input.subFeeling
    : inferSignalSubFeeling(primaryBand, input.fallbackText);
  const resonanceKeywords = normalizeSignalFrequencyKeywords(input.resonanceKeywords);
  const displayText = getSignalFrequencyDisplayText(primaryBand, subFeeling);

  return {
    coreNeed: normalizeShortText(input.coreNeed, "希望确认自己被理解"),
    displayText,
    emotionTone: normalizeShortText(input.emotionTone, "安静复杂"),
    innerConflict: normalizeShortText(input.innerConflict, "想继续往前，又怀疑当下的方向"),
    primaryBand,
    resonanceKeywords,
    subFeeling,
  };
}

function normalizeShortText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0
    ? fallback
    : normalized.slice(0, 120);
}

function normalizeSignalFrequencyKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ["被理解", "自我确认", "缓慢前行"];
  }

  const keywords = value
    .filter((keyword): keyword is string => typeof keyword === "string")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
    .map((keyword) => keyword.slice(0, 16));

  return Array.from(new Set(keywords)).slice(0, 3);
}

function inferSignalPrimaryBand(text: string): SignalPrimaryBand {
  if (/拖延|完成|启动|失败|开始|交出去/u.test(text)) {
    return "stagnant_orbit";
  }

  if (/工作|效率|排名|进度|落后|加班|异化/u.test(text)) {
    return "era_cluster";
  }

  if (/关系|陪|懂|理解|孤独|热闹|问候|想念/u.test(text)) {
    return "relationship_nebula";
  }

  if (/过去|未来|长大|怀念|后来|时间|清晨|明天/u.test(text)) {
    return "time_ring";
  }

  if (/意义|努力|目标|证明|价值|方向|生活/u.test(text)) {
    return "meaning_deep_space";
  }

  if (/累|焦虑|麻木|疲惫|难过|崩溃/u.test(text)) {
    return "emotional_undercurrent";
  }

  return "self_mirror";
}

function inferSignalSubFeeling(
  primaryBand: SignalPrimaryBand,
  text: string,
): SignalSubFeeling {
  if (primaryBand === "self_mirror") {
    if (/接纳|允许|够了|责怪/u.test(text)) return "self_acceptance";
    if (/身份|自己是谁|版本/u.test(text)) return "identity_confusion";
    return "self_doubt";
  }

  if (primaryBand === "emotional_undercurrent") {
    if (/麻木|没感觉/u.test(text)) return "numbness";
    if (/焦虑|慌|担心/u.test(text)) return "anxiety";
    return "fatigue";
  }

  if (primaryBand === "relationship_nebula") {
    if (/失望|解释|远了|道歉/u.test(text)) return "relationship_disappointment";
    if (/理解|听见|接住|陪/u.test(text)) return "need_to_be_understood";
    return "loneliness";
  }

  if (primaryBand === "time_ring") {
    if (/怀念|过去|照片|旧/u.test(text)) return "nostalgia";
    if (/未来|以后|明天/u.test(text)) return "future_uncertainty";
    return "growth_anxiety";
  }

  if (primaryBand === "meaning_deep_space") {
    if (/目标|方向|抵达/u.test(text)) return "goal_loss";
    if (/存在|答案|为什么/u.test(text)) return "existential_questioning";
    return "effort_doubt";
  }

  if (primaryBand === "stagnant_orbit") {
    if (/开始|启动/u.test(text)) return "starting_difficulty";
    if (/失败|评价|完成/u.test(text)) return "fear_of_failure";
    return "procrastination";
  }

  if (/工作|机器|营业/u.test(text)) return "work_alienation";
  if (/孤独|时代/u.test(text)) return "modern_loneliness";
  return "efficiency_anxiety";
}
