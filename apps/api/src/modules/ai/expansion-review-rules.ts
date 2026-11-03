import type { AiSignalExpansionReview, AiSignalSeedClassification } from "./signal-types.js";

type ExpansionMode = AiSignalSeedClassification["expansionMode"];

export function allowsNonSceneExpansion(mode?: ExpansionMode): boolean {
  return mode === "aftertaste" || mode === "clarify_thought";
}

export function hasRequiredExpansionReviewEvidence(
  review: AiSignalExpansionReview,
  mode?: ExpansionMode,
): boolean {
  const hasRequiredScene = allowsNonSceneExpansion(mode) ||
    (review.hasConcreteObjects && review.hasSensoryDetails);

  return hasRequiredScene &&
    review.matchesSeedType &&
    review.preservesOriginalDirection &&
    !review.isGenericLiteraryTemplate &&
    !review.isForcedNegative;
}
