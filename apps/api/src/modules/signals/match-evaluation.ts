export type MatchEvaluationRun = {
  queryId: string;
  judgments: Record<string, number>;
  semanticIds: string[];
  poolIds: string[];
  resultIds: string[];
  latencyMs: number;
  embeddingCalls: number;
  rerankerCalls: number;
  requestBytes: number;
};
const unique = (ids: string[]) => [...new Set(ids)];
const mean = (values: number[]) => values.length === 0 ? null : values.reduce((a,b) => a+b, 0) / values.length;

export function evaluateMatchRun(run: MatchEvaluationRun) {
  const grades = Object.values(run.judgments);
  if (grades.some((grade) => !Number.isInteger(grade) || grade < 0 || grade > 3) ||
      !Number.isFinite(run.latencyMs) || run.latencyMs < 0 ||
      [run.embeddingCalls, run.rerankerCalls, run.requestBytes].some((value) => !Number.isSafeInteger(value) || value < 0) ||
      [run.semanticIds, run.poolIds, run.resultIds].some((ids) => ids.length > 1000 || ids.some((id) => !Object.hasOwn(run.judgments, id))) ||
      run.resultIds.length > 3 || new Set(run.resultIds).size !== run.resultIds.length) throw new Error("Invalid match evaluation run.");
  const relevant = Object.keys(run.judgments).filter((id) => run.judgments[id] > 0);
  const recall = (ids: string[]) => relevant.length === 0 ? null : unique(ids).filter((id) => relevant.includes(id)).length / relevant.length;
  // Explicit exponential-gain DCG, ranks start at one. Queries with no relevant
  // labels are excluded from macro recall/nDCG and reported separately.
  const dcg = (values: number[]) => values.slice(0, 3).reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const ideal = dcg([...grades].sort((a,b) => b-a));
  return { queryId: run.queryId, semanticRecallAtK: recall(run.semanticIds), poolRecall: recall(run.poolIds),
    ndcgAt3: ideal === 0 ? null : dcg(run.resultIds.map((id) => run.judgments[id] ?? 0)) / ideal,
    noMatch: run.resultIds.length === 0, noRelevantLabels: relevant.length === 0,
    falseMatchQuery: relevant.length === 0 && run.resultIds.length > 0,
    ...{ latencyMs: run.latencyMs, embeddingCalls: run.embeddingCalls, rerankerCalls: run.rerankerCalls, requestBytes: run.requestBytes } };
}
export function summarizeMatchEvaluation(runs: MatchEvaluationRun[]) {
  if (runs.length === 0 || new Set(runs.map((run) => run.queryId)).size !== runs.length) throw new Error("Evaluation needs distinct frozen queries.");
  const metrics = runs.map(evaluateMatchRun);
  const latencies = metrics.map((run) => run.latencyMs).sort((a,b) => a-b);
  const nonemptyTruth = metrics.filter((run) => !run.noRelevantLabels);
  const emptyTruth = metrics.filter((run) => run.noRelevantLabels);
  return { queries: runs.length, queriesWithRelevantLabels: nonemptyTruth.length,
    semanticRecallAtK: mean(nonemptyTruth.map((run) => run.semanticRecallAtK!)), poolRecall: mean(nonemptyTruth.map((run) => run.poolRecall!)),
    ndcgAt3: mean(nonemptyTruth.map((run) => run.ndcgAt3!)), noMatchRate: metrics.filter((run) => run.noMatch).length / runs.length,
    falseMatchQueryRate: emptyTruth.length === 0 ? null : emptyTruth.filter((run) => run.falseMatchQuery).length / emptyTruth.length,
    latencyMs: { p50: latencies[Math.ceil(latencies.length * .5)-1], p95: latencies[Math.ceil(latencies.length * .95)-1] },
    embeddingCalls: metrics.reduce((n, run) => n+run.embeddingCalls, 0), rerankerCalls: metrics.reduce((n, run) => n+run.rerankerCalls, 0),
    requestBytes: metrics.reduce((n, run) => n+run.requestBytes, 0),
    humanRelevance: null, currencyCost: null, modelQualityValidated: false,
  };
}
