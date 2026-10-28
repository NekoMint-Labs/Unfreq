import { z } from "zod";
import {
  signalPrimaryBands,
  signalSubFeelings,
} from "./frequency-taxonomy.js";

const signalGenerationStatuses = [
  "RECEIVED",
  "EXPANDING",
  "MATCHING",
  "WRITING",
  "COMPLETED",
  "FAILED",
] as const;

export const signalIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const signalGalaxyQuerySchema = z.object({
  band: z.enum(signalPrimaryBands).optional(),
  theme: z.string().trim().min(1).max(48).optional(),
});

export const createPublishedSignalBodySchema = z.object({
  parentSignalId: z.string().uuid().optional(),
  seedText: z.string().trim().min(5).max(200),
});

export const createSignalEchoBodySchema = z.object({
  content: z.string().trim().min(1).max(500),
});

export const signalResonanceBodySchema = z.object({});

export const signalFingerprintSchema = z.object({
  coreNeed: z.string().min(1),
  displayText: z.string().min(1),
  energy: z.number().min(0).max(1),
  emotionTone: z.string().min(1),
  frequency: z.string().min(1),
  hiddenNeed: z.string().min(1),
  innerConflict: z.string().min(1),
  narrativeConflict: z.string().min(1),
  openness: z.number().min(0).max(1),
  primaryEmotion: z.string().min(1),
  primaryBand: z.enum(signalPrimaryBands),
  resonanceKeywords: z.array(z.string().min(1)).min(1).max(3),
  riskLevel: z.enum(["HIGH", "LOW", "MEDIUM"]),
  secondaryEmotions: z.array(z.string().min(1)),
  signalType: z.string().min(1),
  subFeeling: z.enum(signalSubFeelings),
  tags: z.array(z.string().min(1)),
  theme: z.string().min(1),
  title: z.string().min(1),
});

export const signalFrequencyProfileSchema = z.object({
  coreNeed: z.string().min(1),
  displayText: z.string().min(1),
  emotionTone: z.string().min(1),
  innerConflict: z.string().min(1),
  primaryBand: z.enum(signalPrimaryBands),
  resonanceKeywords: z.array(z.string().min(1)).min(1).max(3),
  subFeeling: z.enum(signalSubFeelings),
});

export const signalProgramSchema = z.object({
  bridgeNarration: z.string().min(1),
  closingQuestion: z.string().min(1),
  hostIntro: z.string().min(1),
  leftSignalSummary: z.string().min(1),
  programTitle: z.string().min(1),
  rightSignalSummary: z.string().min(1).optional(),
  shareQuote: z.string().min(1),
});

export const signalMatchSummarySchema = z.object({
  distance: z.number().nonnegative().optional(),
  expandedText: z.string().min(1),
  frequencyProfile: signalFrequencyProfileSchema,
  frequencyCode: z.string().min(1),
  id: z.string().min(1),
  primaryEmotion: z.string().min(1),
  resonanceCount: z.number().int().nonnegative(),
  score: z.number().min(0),
  seedText: z.string().min(1).optional(),
  signalType: z.string().min(1),
  source: z.enum(["FALLBACK", "PUBLISHED", "SEEDED"]),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)),
  title: z.string().min(1),
});

export const signalGalaxyPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const galaxySignalPointSchema = z.object({
  createdAt: z.string(),
  expandedText: z.string().min(1),
  frequencyProfile: signalFrequencyProfileSchema,
  frequencyCode: z.string().min(1),
  id: z.string().uuid(),
  isMine: z.boolean(),
  matchIds: z.array(z.string().uuid()),
  position: signalGalaxyPositionSchema,
  resonanceCount: z.number().int().nonnegative(),
  source: z.enum(["ai_generated", "human", "seed"]),
  theme: z.string().min(1),
});

export const signalDetailSchema = z.object({
  audioError: z.string().optional(),
  audioStatus: z.enum(["FAILED", "NOT_REQUESTED", "PENDING", "READY"]),
  audioUrl: z.string().optional(),
  audioUrlLeft: z.string().optional(),
  audioUrlRight: z.string().optional(),
  authorFreqCode: z.string().optional(),
  createdAt: z.string(),
  echoCount: z.number().int().nonnegative(),
  expandedText: z.string(),
  fingerprint: signalFingerprintSchema,
  followUpQuestion: z.string().optional(),
  frequencyProfile: signalFrequencyProfileSchema,
  frequencyId: z.string().uuid().optional(),
  galaxyPosition: signalGalaxyPositionSchema.optional(),
  guestKey: z.string().optional(),
  id: z.string().uuid(),
  matchSignalId: z.string().uuid().optional(),
  matches: z.array(signalMatchSummarySchema),
  parentSignalId: z.string().uuid().optional(),
  program: signalProgramSchema,
  qualityReason: z.string().optional(),
  qualityScore: z.number().int().min(1).max(5).optional(),
  rawInput: z.string(),
  resonanceCount: z.number().int().nonnegative(),
  seedText: z.string(),
  source: z.enum(["ai_generated", "human", "seed"]),
  status: z.enum(["DELETED", "DRAFT", "HIDDEN", "PUBLISHED", "REVIEWING"]),
  isKept: z.boolean(),
  hasSaved: z.boolean().optional(),
  updatedAt: z.string(),
});

export const reviewingSignalRestrictedDetailSchema = z.object({
  createdAt: z.string(),
  id: z.string().uuid(),
  status: z.literal("REVIEWING"),
  updatedAt: z.string(),
  visibility: z.literal("REVIEW_RESTRICTED"),
});

export const signalPreviewDetailSchema = signalDetailSchema.extend({
  status: z.literal("DRAFT"),
  visibility: z.literal("PREVIEW_OWNER"),
});

export const signalGenerationDetailSchema = z.object({
  createdAt: z.string(),
  generationError: z.string().optional(),
  generationStatus: z.enum(signalGenerationStatuses),
  id: z.string().uuid(),
  parentSignalId: z.string().uuid().optional(),
  seedText: z.string(),
  status: z.enum(["DELETED", "DRAFT", "HIDDEN", "PUBLISHED", "REVIEWING"]),
  updatedAt: z.string(),
  visibility: z.literal("GENERATION_OWNER"),
});

export const signalResultDetailSchema = z.union([
  signalPreviewDetailSchema,
  signalDetailSchema,
  reviewingSignalRestrictedDetailSchema,
  signalGenerationDetailSchema,
]);

export const signalAudioDetailSchema = z.object({
  audioError: z.string().optional(),
  audioStatus: z.enum(["FAILED", "NOT_REQUESTED", "PENDING", "READY"]),
  audioUrl: z.string().optional(),
  audioUrlLeft: z.string().optional(),
  audioUrlRight: z.string().optional(),
  signalId: z.string().uuid(),
});

export const signalAudioResponseSchema = z.object({
  audio: signalAudioDetailSchema,
});

export const signalAudioSideParamsSchema = signalIdParamsSchema.extend({
  side: z.enum(["left", "main", "right"]),
});

export const signalEchoDetailSchema = z.object({
  authorFreqCode: z.string().optional(),
  content: z.string(),
  createdAt: z.string(),
  guestKey: z.string().optional(),
  id: z.string().uuid(),
  signalId: z.string().uuid(),
  status: z.enum(["DELETED", "HIDDEN", "PUBLISHED", "REVIEWING"]),
});

export const signalResponseSchema = z.object({
  signal: signalResultDetailSchema,
});

export const signalMatchesResponseSchema = z.object({
  matches: z.array(signalMatchSummarySchema),
});

export const signalHallResponseSchema = z.object({
  signals: z.array(signalDetailSchema),
});

export const signalGalaxyResponseSchema = z.object({
  bandOptions: z.array(z.object({
    label: z.string().min(1),
    value: z.enum(signalPrimaryBands),
  })),
  generatedAt: z.string(),
  points: z.array(galaxySignalPointSchema),
  themeOptions: z.array(z.string().min(1)),
});

export const signalEchoResponseSchema = z.object({
  echo: signalEchoDetailSchema,
});

export const signalEchoesResponseSchema = z.object({
  echoes: z.array(signalEchoDetailSchema),
});

export const signalResonanceResponseSchema = z.object({
  resonance: z.object({
    hasResonated: z.boolean(),
    resonanceCount: z.number().int().nonnegative(),
  }),
});

export const signalSaveResponseSchema = z.object({
  save: z.object({
    hasSaved: z.boolean(),
  }),
});

export const mySignalSummarySchema = z.object({
  createdAt: z.string(),
  expandedText: z.string(),
  frequencyProfile: signalFrequencyProfileSchema,
  id: z.string().uuid(),
  parentSignalId: z.string().uuid().optional(),
  resonanceCount: z.number().int().nonnegative(),
  seedText: z.string(),
  status: z.enum(["DELETED", "DRAFT", "HIDDEN", "PUBLISHED", "REVIEWING"]),
});

export const mySignalsResponseSchema = z.object({
  signals: z.array(mySignalSummarySchema),
  totalResonanceCount: z.number().int().nonnegative(),
});

export const echoSummaryResponseSchema = z.object({
  summary: z.object({
    frequencyId: z.string(),
    newResonanceCount: z.number().int().nonnegative(),
    since: z.string().optional(),
    topSignal: mySignalSummarySchema.optional(),
    totalResonanceCount: z.number().int().nonnegative(),
  }),
});

export const savedSignalSummarySchema = mySignalSummarySchema.extend({
  authorFreqCode: z.string().optional(),
  frequencyProfile: signalFrequencyProfileSchema,
  savedAt: z.string(),
  theme: z.string().min(1),
});

export const savedSignalsResponseSchema = z.object({
  signals: z.array(savedSignalSummarySchema),
});

export type CreatePublishedSignalBody = z.infer<typeof createPublishedSignalBodySchema>;
export type CreateSignalEchoBody = z.infer<typeof createSignalEchoBodySchema>;
export type SignalResonanceBody = z.infer<typeof signalResonanceBodySchema>;
export type SignalGalaxyQuery = z.infer<typeof signalGalaxyQuerySchema>;
