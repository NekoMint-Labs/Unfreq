import { env } from "../../config/env.js";
import { isPublicSignal } from "./publication-policy.js";
import type { SignalPrimaryBand, SignalRecord } from "./types.js";

export const matchPolicyVersion = "match-policy-v1";
export type MatchPolicy = { semanticCandidates: number; ruleCandidates: number; minScore: number; maxRerankCharacters: number };
export type MatchScope = {
  excludeSignalId?: string;
  excludeAuthorIds?: readonly string[];
  /** Only narrows the public corpus; used by reproducible evaluation, never exposed as an HTTP query option. */
  corpusIds?: readonly string[];
  tags?: readonly string[];
  band?: SignalPrimaryBand;
};
export function resolveMatchPolicy(override?: MatchPolicy): MatchPolicy {
  const policy = override ?? { semanticCandidates: env.signalMatchSemanticCandidates, ruleCandidates: env.signalMatchRuleCandidates,
    minScore: env.signalMatchMinScore, maxRerankCharacters: env.signalMatchMaxRerankCharacters };
  if (![policy.semanticCandidates, policy.ruleCandidates].every((n) => Number.isInteger(n) && n >= 1 && n <= 50) ||
      !Number.isFinite(policy.minScore) || policy.minScore < 0 || policy.minScore > 100 ||
      !Number.isInteger(policy.maxRerankCharacters) || policy.maxRerankCharacters < 1 || policy.maxRerankCharacters > 100000) {
    throw new Error("Invalid matching policy.");
  }
  return { ...policy };
}
export function isMatchEligible(signal: SignalRecord, scope: MatchScope): boolean {
  const author = signal.authorId ?? signal.frequencyId;
  return isPublicSignal(signal) && signal.source === "human" && typeof author === "string" && author.length > 0 &&
    signal.id !== scope.excludeSignalId && !scope.excludeAuthorIds?.includes(author) &&
    (scope.corpusIds === undefined || scope.corpusIds.includes(signal.id));
}
