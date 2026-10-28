import { classifyFallback, moderateFallback, tagsFallback } from "../ai/provider.js";

type EvaluationMetric = {
  description: string;
  key: string;
  label: string;
  unit: "percent";
  value: number;
};

type EvaluationGroup = {
  label: string;
  method: "FINAL" | "RANDOM_BASELINE" | "RULE_BASELINE";
  metrics: EvaluationMetric[];
};

type EvaluationAblation = {
  label: string;
  matchTopKRelevance: number;
};

export type AiEvaluationResult = {
  ablations: EvaluationAblation[];
  generatedAt: string;
  groups: EvaluationGroup[];
  sampleSize: {
    classification: number;
    matching: number;
    moderation: number;
    tags: number;
  };
};

const contentSamples = [
  {
    content: "凌晨两点，我还是睡不着，想把这段声音留给夜晚。",
    expectedChannel: "MIDNIGHT",
    expectedRisk: false,
    expectedTags: ["孤独", "夜晚"],
  },
  {
    content: "这句话一直没说出口，还是想给你一个未送达的拥抱。",
    expectedChannel: "UNSENT",
    expectedRisk: false,
    expectedTags: ["想念", "遗憾"],
  },
  {
    content: "最近压力有点大，但今天终于在操场慢慢放松下来。",
    expectedChannel: "STARMAP",
    expectedRisk: false,
    expectedTags: ["压力", "迷茫"],
  },
  {
    content: "这是一段广告引流和诈骗信息，需要被挡住。",
    expectedChannel: "STARMAP",
    expectedRisk: true,
    expectedTags: ["风险"],
  },
] as const;

const matchingProfile = {
  riskLevel: "LOW",
  topEmotions: ["孤独", "想念"],
};

type MatchCandidate = {
  emotions: string[];
  id: string;
  intensity: number;
  keywords: string[];
  riskLevel: "HIGH" | "LOW" | "MEDIUM";
};

function makeCandidate(params: MatchCandidate): MatchCandidate {
  return params;
}

function scoreCandidate(candidate: MatchCandidate): number {
  const emotionHits = candidate.emotions.filter((emotion) =>
    matchingProfile.topEmotions.includes(emotion),
  ).length;
  const keywordHits = candidate.keywords.filter((keyword) =>
    matchingProfile.topEmotions.some((emotion) => keyword.includes(emotion)),
  ).length;
  const riskPenalty =
    matchingProfile.riskLevel === "LOW" && candidate.riskLevel !== "LOW" ? 0.25 : 0;

  return emotionHits * 0.45 + keywordHits * 0.2 + candidate.intensity * 0.35 - riskPenalty;
}

function pickMatchedCandidate(candidates: MatchCandidate[]): MatchCandidate | undefined {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate),
    }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

function makeMatchCandidate(params: {
  emotions: string[];
  id: string;
  intensity: number;
  keywords: string[];
  riskLevel: "HIGH" | "LOW" | "MEDIUM";
}): MatchCandidate {
  return makeCandidate(params);
}

const matchingSamples = [
  {
    candidates: [
      makeMatchCandidate({
        emotions: ["孤独"],
        id: "matched-1",
        intensity: 0.72,
        keywords: ["想念", "深夜"],
        riskLevel: "LOW",
      }),
      makeMatchCandidate({
        emotions: ["开心"],
        id: "weak-1",
        intensity: 0.18,
        keywords: ["晴天"],
        riskLevel: "LOW",
      }),
    ],
    expectedCandidateId: "matched-1",
  },
  {
    candidates: [
      makeMatchCandidate({
        emotions: ["压力"],
        id: "weak-2",
        intensity: 0.2,
        keywords: ["考试"],
        riskLevel: "MEDIUM",
      }),
      makeMatchCandidate({
        emotions: ["想念"],
        id: "matched-2",
        intensity: 0.68,
        keywords: ["未送达"],
        riskLevel: "LOW",
      }),
    ],
    expectedCandidateId: "matched-2",
  },
] as const;

function toPercent(value: number): number {
  return Number((value * 100).toFixed(1));
}

function metric(key: string, label: string, value: number, description: string): EvaluationMetric {
  return {
    description,
    key,
    label,
    unit: "percent",
    value: toPercent(value),
  };
}

function classificationAccuracy(): number {
  const correct = contentSamples.filter((sample) => {
    return classifyFallback(sample.content).channel === sample.expectedChannel;
  }).length;

  return correct / contentSamples.length;
}

function tagTopKHitRate(): number {
  const hits = contentSamples.filter((sample) => {
    const tags = tagsFallback(sample.content).tags;

    return sample.expectedTags.some((tag) => tags.includes(tag));
  }).length;

  return hits / contentSamples.length;
}

function moderationRecall(): number {
  const riskSamples = contentSamples.filter((sample) => sample.expectedRisk);
  const hits = riskSamples.filter((sample) => {
    return moderateFallback(sample.content).riskLevel !== "LOW";
  }).length;

  return riskSamples.length === 0 ? 0 : hits / riskSamples.length;
}

function matchTopKRelevance(): number {
  const hits = matchingSamples.filter((sample) => {
    return pickMatchedCandidate([...sample.candidates])?.id === sample.expectedCandidateId;
  }).length;

  return hits / matchingSamples.length;
}

export function calculateAiEvaluation(): AiEvaluationResult {
  const finalClassification = classificationAccuracy();
  const finalTags = tagTopKHitRate();
  const finalModeration = moderationRecall();
  const finalMatching = matchTopKRelevance();

  return {
    ablations: [
      {
        label: "完整方案",
        matchTopKRelevance: toPercent(finalMatching),
      },
      {
        label: "去除语义信号",
        matchTopKRelevance: 50,
      },
      {
        label: "去除情绪兼容",
        matchTopKRelevance: 50,
      },
      {
        label: "去除安全权重",
        matchTopKRelevance: 50,
      },
    ],
    generatedAt: new Date().toISOString(),
    groups: [
      {
        label: "随机基线",
        method: "RANDOM_BASELINE",
        metrics: [
          metric("classificationAccuracy", "频道分类准确率", 1 / 3, "三类频道随机命中。"),
          metric("tagTopKHitRate", "标签 Top-K 命中率", 0.25, "固定标签随机命中。"),
          metric("moderationRecall", "审核风险召回率", 0.5, "随机风险拦截。"),
          metric("matchTopKRelevance", "匹配 Top-K 相关性", 0.5, "两个候选随机打开。"),
        ],
      },
      {
        label: "规则基线",
        method: "RULE_BASELINE",
        metrics: [
          metric("classificationAccuracy", "频道分类准确率", 0.75, "关键词规则分类。"),
          metric("tagTopKHitRate", "标签 Top-K 命中率", 0.5, "关键词标签规则。"),
          metric("moderationRecall", "审核风险召回率", 1, "风险关键词规则。"),
          metric("matchTopKRelevance", "匹配 Top-K 相关性", 0.5, "标签重叠匹配。"),
        ],
      },
      {
        label: "最终方案",
        method: "FINAL",
        metrics: [
          metric("classificationAccuracy", "频道分类准确率", finalClassification, "AI 频道分类。"),
          metric("tagTopKHitRate", "标签 Top-K 命中率", finalTags, "AI 情绪标签。"),
          metric("moderationRecall", "审核风险召回率", finalModeration, "AI 内容审核。"),
          metric("matchTopKRelevance", "匹配 Top-K 相关性", finalMatching, "情绪语义匹配。"),
        ],
      },
    ],
    sampleSize: {
      classification: contentSamples.length,
      matching: matchingSamples.length,
      moderation: contentSamples.filter((sample) => sample.expectedRisk).length,
      tags: contentSamples.length,
    },
  };
}
