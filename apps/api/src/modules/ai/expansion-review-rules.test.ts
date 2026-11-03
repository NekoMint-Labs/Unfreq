import { describe, expect, it } from "vitest";
import { aiSignalExpansionReviewSchema, createAiSignalExpansionReviewSchema } from "./schemas.js";
import type { AiSignalExpansionMode, AiSignalExpansionReview } from "./signal-types.js";

const nonSceneReview: AiSignalExpansionReview = {
  hasConcreteObjects: false,
  hasSensoryDetails: false,
  isForcedNegative: false,
  isGenericLiteraryTemplate: false,
  matchesSeedType: true,
  pass: true,
  preservesOriginalDirection: true,
  problems: [],
  rewriteInstruction: "",
  score: 9,
};

describe("mode-aware expansion review evidence", () => {
  it.each<AiSignalExpansionMode>(["aftertaste", "clarify_thought"])(
    "allows truthful missing scene flags in %s without changing other criteria",
    (mode) => {
      const schema = createAiSignalExpansionReviewSchema(mode);
      expect(schema.parse(nonSceneReview)).toEqual(nonSceneReview);
      for (const changed of [
        { isForcedNegative: true },
        { isGenericLiteraryTemplate: true },
        { preservesOriginalDirection: false },
        { matchesSeedType: false },
        { pass: false },
      ]) {
        expect(schema.parse({ ...nonSceneReview, ...changed }).pass).toBe(false);
      }
    },
  );

  it.each<AiSignalExpansionMode>(["light_scene", "continue_image", "joke_extension", "ask_detail"])(
    "retains concrete and sensory evidence in %s even for a high score",
    (mode) => {
      const schema = createAiSignalExpansionReviewSchema(mode);
      expect(schema.parse(nonSceneReview).pass).toBe(false);
      expect(schema.parse({ ...nonSceneReview, hasConcreteObjects: true }).pass).toBe(false);
      expect(schema.parse({ ...nonSceneReview, hasSensoryDetails: true }).pass).toBe(false);
      expect(schema.parse({ ...nonSceneReview, hasConcreteObjects: true, hasSensoryDetails: true }).pass).toBe(true);
    },
  );

  it("keeps both scene requirements when the actual classification is unavailable", () => {
    expect(aiSignalExpansionReviewSchema.parse(nonSceneReview).pass).toBe(false);
  });
});
