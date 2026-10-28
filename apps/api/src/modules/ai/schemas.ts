import { z } from "zod";
import {
  normalizeSignalFrequencyProfile,
  signalBandLabels,
  signalPrimaryBands,
  signalSubFeelingLabels,
  signalSubFeelings,
} from "../signals/frequency-taxonomy.js";

export const aiContentBodySchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

export const aiClassificationSchema = z.object({
  channel: z.enum(["MIDNIGHT", "STARMAP", "UNSENT"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(240),
});

export const aiTagSuggestionSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(12)).max(8),
});

export const aiModerationSchema = z.object({
  action: z.enum(["ALLOW", "HIDE", "REVIEW"]),
  reason: z.string().trim().min(1).max(240),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

export const aiContentAnalysisSchema = z.object({
  emotions: z.array(z.string().trim().min(1).max(16)).min(1).max(6),
  intensity: z.number().min(0).max(1),
  keywords: z.array(z.string().trim().min(1).max(16)).max(8),
  reason: z.string().trim().min(1).max(240),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  summary: z.string().trim().min(1).max(160),
});

export const aiMonthlyRecapSchema = z.object({
  summary: z.string().trim().min(1).max(100),
  themeWords: z.array(z.string().trim().min(1).max(12)).min(1).max(3),
});

export const aiEchoSuggestionSchema = z.object({
  suggestion: z.string().trim().min(1).max(500),
});

export const aiSignalFingerprintSchema = z.object({
  coreNeed: z.string().trim().min(1).max(120),
  displayText: z.string().trim().min(1).max(48),
  energy: z.number().min(0).max(1),
  emotionTone: z.string().trim().min(1).max(48),
  frequency: z.string().trim().min(1).max(32),
  hiddenNeed: z.string().trim().min(1).max(120),
  innerConflict: z.string().trim().min(1).max(160),
  narrativeConflict: z.string().trim().min(1).max(160),
  openness: z.number().min(0).max(1),
  primaryEmotion: z.string().trim().min(1).max(24),
  primaryBand: z.enum(signalPrimaryBands),
  resonanceKeywords: z.array(z.string().trim().min(1).max(16)).min(1).max(3),
  riskLevel: z.enum(["HIGH", "LOW", "MEDIUM"]),
  secondaryEmotions: z.array(z.string().trim().min(1).max(24)).max(4),
  signalType: z.string().trim().min(1).max(32),
  subFeeling: z.enum(signalSubFeelings),
  tags: z.array(z.string().trim().min(1).max(16)).min(1).max(8),
  theme: z.string().trim().min(1).max(48),
  title: z.string().trim().min(1).max(48),
}).transform((fingerprint) => {
  const frequencyProfile = normalizeSignalFrequencyProfile({
    coreNeed: fingerprint.coreNeed,
    emotionTone: fingerprint.emotionTone,
    fallbackText: [
      fingerprint.title,
      fingerprint.theme,
      fingerprint.primaryEmotion,
      fingerprint.secondaryEmotions.join("、"),
      fingerprint.narrativeConflict,
      fingerprint.hiddenNeed,
      fingerprint.tags.join("、"),
    ].join("\n"),
    innerConflict: fingerprint.innerConflict,
    primaryBand: fingerprint.primaryBand,
    resonanceKeywords: fingerprint.resonanceKeywords,
    subFeeling: fingerprint.subFeeling,
  });

  return {
    ...fingerprint,
    coreNeed: frequencyProfile.coreNeed,
    displayText: frequencyProfile.displayText,
    emotionTone: frequencyProfile.emotionTone,
    hiddenNeed: frequencyProfile.coreNeed,
    innerConflict: frequencyProfile.innerConflict,
    narrativeConflict: frequencyProfile.innerConflict,
    primaryBand: frequencyProfile.primaryBand,
    primaryEmotion: signalSubFeelingLabels[frequencyProfile.subFeeling],
    resonanceKeywords: frequencyProfile.resonanceKeywords,
    signalType: frequencyProfile.primaryBand,
    subFeeling: frequencyProfile.subFeeling,
    tags: fingerprint.tags,
    theme: signalBandLabels[frequencyProfile.primaryBand],
  };
});

export const aiSignalProgramSchema = z.object({
  bridgeNarration: z.string().trim().min(1).max(240),
  closingQuestion: z.string().trim().min(1).max(160),
  hostIntro: z.string().trim().min(1).max(180),
  leftSignalSummary: z.string().trim().min(1).max(220),
  programTitle: z.string().trim().min(1).max(80),
  rightSignalSummary: z.string().trim().min(1).max(220).optional(),
  shareQuote: z.string().trim().min(1).max(120),
});

export const aiSignalExpansionSchema = z.object({
  expandedText: z
    .string()
    .trim()
    .min(80)
    .max(180)
    .refine(
      (value) =>
        !/我把这句话留在心里|我把这句种子|我没有急着把它说出口|真实感受放到前面|杯子凉了|手机暗下去|房间只剩风声|沉默挡风|绕着同一个问题走|你辛苦了|被世界接住/u.test(value),
      {
        message: "Expanded signal contains a blocked template phrase.",
      },
    ),
  followUpQuestion: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => /[?？]$/u.test(value), {
      message: "Follow-up question must end with a question mark.",
    }),
});

function toDefaultSignalInputKind(type: string) {
  if (type === "poetry") return "classic_poem";
  if (type === "absurd") return "absurd";
  if (type === "daily_wish") return "wish";
  if (type === "question") return "question";
  if (type === "emotion" || type === "observation") return "original_thought";
  if (type === "unknown") return "unknown";

  return "fragment";
}

function toDefaultSignalUserAct(type: string) {
  if (type === "poetry") return "quote_for_aftertaste";
  if (type === "daily_wish") return "make_wish";
  if (type === "question") return "ask_question";
  if (type === "sports") return "invite";
  if (type === "absurd") return "record_fragment";
  if (type === "observation") return "state_opinion";
  if (type === "emotion") return "state_feeling";

  return "record_fragment";
}

const aiSignalExpansionModeSchema = z
  .enum([
    "aftertaste",
    "ask_detail",
    "clarify_thought",
    "continue_image",
    "crowd_action_scene",
    "daily_scene",
    "emotional_contrast_scene",
    "emotional_scene",
    "imaginative_scene",
    "joke_extension",
    "light_scene",
    "question_scene",
    "seasonal_landscape",
    "sensory_scene",
    "concrete_observation",
  ])
  .transform((value) => {
    if (value === "sensory_scene" || value === "crowd_action_scene" || value === "daily_scene") {
      return "light_scene";
    }

    if (value === "emotional_contrast_scene" || value === "emotional_scene" || value === "concrete_observation") {
      return "clarify_thought";
    }

    if (value === "seasonal_landscape") {
      return "aftertaste";
    }

    if (value === "question_scene") {
      return "ask_detail";
    }

    if (value === "imaginative_scene") {
      return "continue_image";
    }

    return value;
  });

export const aiSignalSeedClassificationSchema = z.object({
  allowedInventions: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
  confidence: z.number().min(0).max(1).optional(),
  energy: z.enum(["high", "low", "medium"]),
  expansionMode: aiSignalExpansionModeSchema,
  forbiddenInventions: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
  inputKind: z
    .enum([
      "absurd",
      "classic_poem",
      "fragment",
      "joke",
      "original_thought",
      "question",
      "quote",
      "unknown",
      "wish",
    ])
    .optional(),
  intendedFocus: z.string().trim().min(1).max(120).optional(),
  inventionLevel: z.enum(["none", "low", "medium"]).optional(),
  keywords: z.array(z.string().trim().min(1).max(16)).min(1).max(8),
  mood: z.string().trim().min(1).max(24),
  mustAvoid: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  preserve: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  sceneHint: z.string().trim().min(1).max(120).optional(),
  shouldBeNegative: z.boolean(),
  type: z.enum([
    "absurd",
    "daily_wish",
    "emotion",
    "food",
    "memory",
    "observation",
    "poetry",
    "question",
    "sports",
    "unknown",
  ]),
  userAct: z
    .enum([
      "ask_question",
      "invite",
      "joke",
      "make_wish",
      "quote_for_aftertaste",
      "record_fragment",
      "state_feeling",
      "state_opinion",
    ])
    .optional(),
}).transform((classification) => {
  const preserve = classification.preserve ?? classification.keywords.slice(0, 4);
  const intendedFocus = classification.intendedFocus ?? classification.keywords.join("、");
  const mustAvoid = classification.mustAvoid ?? [];
  const forbiddenInventions = classification.forbiddenInventions ?? mustAvoid;

  return {
    ...classification,
    allowedInventions: classification.allowedInventions ?? [],
    confidence: classification.confidence ?? 0.6,
    forbiddenInventions,
    inputKind: classification.inputKind ?? toDefaultSignalInputKind(classification.type),
    intendedFocus,
    inventionLevel: classification.inventionLevel ?? "medium",
    mustAvoid,
    preserve,
    sceneHint: classification.sceneHint ?? intendedFocus,
    userAct: classification.userAct ?? toDefaultSignalUserAct(classification.type),
  };
});

export const aiSignalMaterialSchema = z.object({
  classification: aiSignalSeedClassificationSchema,
  expansion: aiSignalExpansionSchema,
  fingerprint: aiSignalFingerprintSchema,
});

const aiSignalExpansionReviewBaseSchema = z.object({
  hasConcreteObjects: z.boolean(),
  hasSensoryDetails: z.boolean(),
  isForcedNegative: z.boolean(),
  isGenericLiteraryTemplate: z.boolean(),
  matchesSeedType: z.boolean(),
  pass: z.boolean(),
  preservesOriginalDirection: z.boolean(),
  problems: z.array(z.string().trim().min(1).max(80)).max(8),
  rewriteInstruction: z.string().trim().max(260),
  score: z.number().min(0).max(10),
});

export const aiSignalExpansionReviewSchema = aiSignalExpansionReviewBaseSchema.transform(
  (review) => {
    const requiredPass =
      review.hasConcreteObjects &&
      review.hasSensoryDetails &&
      review.matchesSeedType &&
      review.preservesOriginalDirection &&
      !review.isGenericLiteraryTemplate &&
      !review.isForcedNegative;

    return {
      ...review,
      pass: review.pass && requiredPass,
    };
  },
);

export const aiSignalContentSchema = z.object({
  rawInput: z.string().trim().min(30).max(100),
});

export const aiSignalQualitySchema = z.object({
  reason: z.string().trim().min(1).max(160),
  score: z.number().int().min(1).max(5),
});

export type AiContentBody = z.infer<typeof aiContentBodySchema>;
