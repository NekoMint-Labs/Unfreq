import { createHash } from "node:crypto";
import type { AdminAiEvaluation } from "@unfreq/contracts/admin";
import { classifyFallback, moderateFallback, tagsFallback } from "../ai/provider.js";

export type AiEvaluationResult = AdminAiEvaluation;
type FixtureOutput = AiEvaluationResult["fixtureOutputs"][number];
type EvaluationMetric = AiEvaluationResult["groups"][number]["metrics"][number];

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

function metric(
  key: string,
  label: string,
  outputs: FixtureOutput[],
  task: FixtureOutput["task"],
  method: string,
  description: string,
): EvaluationMetric {
  const samples = outputs.filter((output) => output.task === task);
  const numerator = samples.filter((output) => output.hit).length;
  const denominator = samples.length;

  return {
    denominator,
    description,
    key,
    label,
    method,
    numerator,
    unit: "percent",
    value: denominator === 0 ? 0 : toPercent(numerator / denominator),
  };
}

// This dataset is deliberately synthetic. The matcher is the historical local
// demo scorer above, not the current service-matching/E3 production pipeline.
const dataset = {
  judgmentSource: "synthetic-presets-not-human" as const,
  sha256: createHash("sha256").update(JSON.stringify({
    contentSamples,
    matchingProfile,
    matchingSamples,
    matcherVersion: "legacy-demo-matcher-v1",
  })).digest("hex"),
  version: "admin-rule-fixtures-v1",
};

function runFixtures(): FixtureOutput[] {
  const outputs: FixtureOutput[] = [];

  for (const [index, sample] of contentSamples.entries()) {
    const channel = classifyFallback(sample.content).channel;
    const tags = tagsFallback(sample.content).tags;
    outputs.push({
      actual: [channel], expected: [sample.expectedChannel],
      hit: channel === sample.expectedChannel, id: `content-${index + 1}`, task: "classification",
    }, {
      actual: tags, expected: [...sample.expectedTags],
      hit: sample.expectedTags.some((tag) => tags.includes(tag)),
      id: `content-${index + 1}`, task: "tags",
    });
    if (sample.expectedRisk) {
      const risk = moderateFallback(sample.content).riskLevel;
      outputs.push({
        actual: [risk], expected: ["MEDIUM", "HIGH"], hit: risk !== "LOW",
        id: `content-${index + 1}`, task: "moderation",
      });
    }
  }

  for (const [index, sample] of matchingSamples.entries()) {
    const candidate = pickMatchedCandidate([...sample.candidates]);
    outputs.push({
      actual: candidate === undefined ? [] : [candidate.id],
      expected: [sample.expectedCandidateId], hit: candidate?.id === sample.expectedCandidateId,
      id: `matching-${index + 1}`, task: "matching",
    });
  }

  return outputs;
}

export function calculateAiEvaluation(): AiEvaluationResult {
  const fixtureOutputs = runFixtures();

  return {
    ablationStatus: "NOT_RUN",
    ablations: [],
    competitionEvidenceEligible: false,
    dataset: { ...dataset },
    evaluationKind: "DEMO_RULE_FIXTURES",
    fixtureOutputs,
    generatedAt: new Date().toISOString(),
    groups: [
      {
        label: "Demo / 本地规则夹具",
        method: "RULE_BASELINE",
        metrics: [
          metric("classificationAccuracy", "频道预设命中率", fixtureOutputs, "classification",
            "classifyFallback：预测频道等于夹具预设频道。", "4 条合成内容，不代表真实模型分类准确率。"),
          metric("tagTopKHitRate", "标签预设命中率", fixtureOutputs, "tags",
            "tagsFallback：返回标签至少命中一个预设标签；每条内容计一次。", "返回至多 5 个标签，不代表人工标注质量。"),
          metric("moderationRecall", "风险预设检出率", fixtureOutputs, "moderation",
            "moderateFallback：仅在预设有风险的样例中统计非 LOW 返回。", "分母仅 1 条风险样例，不包含无风险样例的误报评价。"),
          metric("matchTop1PresetHitRate", "匹配 Top-1 预设命中率", fixtureOutputs, "matching",
            "旧 Demo matcher：对固定候选打分后取第一名，与预设候选 ID 比较。", "未调用 E3 召回/重排路径，不是人工相关性或生产匹配效果。"),
        ],
      },
    ],
    limitations: [
      "所有输入与标签均为合成预设；没有双人盲评、作者认可或真实 Provider 运行。",
      "匹配仅运行历史 Demo scorer，未调用当前 E3 生产召回与重排路径。",
      "未运行真实消融，未测量模型费用、延迟或生产失败降级。",
      "这些百分比只用于核对本地规则，不得作为参赛实测指标或模型提升证据。",
    ],
    modelQualityValidated: false,
    sampleSize: {
      classification: contentSamples.length,
      matching: matchingSamples.length,
      moderation: contentSamples.filter((sample) => sample.expectedRisk).length,
      tags: contentSamples.length,
    },
  };
}
