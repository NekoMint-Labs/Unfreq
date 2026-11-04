// Preserve the old semantic/rule blend: 0.6 * retrieval(0..100) + rules(0..40).
// Express it explicitly on [0,1], then convert once to the existing public 0..100 scale.
export const matchScoreVersion = "match-score-v1";
export const matchWeights = Object.freeze({ retrieval: 0.6, rules: 0.4 });
export const ruleScoreMaximum = 40;

export function cosineRelevance(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0 || distance > 2) throw new Error("Invalid cosine distance.");
  // Existing monotone transform, now explicitly normalized. No new threshold or calibration claim.
  return 1 / (1 + distance);
}

export function composeMatchScore(retrieval: number | undefined, rules: number): number {
  if (!Number.isFinite(rules) || rules < 0 || rules > ruleScoreMaximum ||
      (retrieval !== undefined && (!Number.isFinite(retrieval) || retrieval < 0 || retrieval > 1))) {
    throw new Error("Invalid normalized match score.");
  }
  return Number((100 * (matchWeights.retrieval * (retrieval ?? 0) + matchWeights.rules * (rules / ruleScoreMaximum))).toFixed(4));
}
