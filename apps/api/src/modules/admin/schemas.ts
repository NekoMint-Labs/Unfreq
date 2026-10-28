import { z } from "zod";

export const adminSignalStatusSchema = z.enum([
  "DELETED",
  "DRAFT",
  "HIDDEN",
  "PUBLISHED",
  "REVIEWING",
]);
export const adminUserStatusSchema = z.enum(["ACTIVE", "BANNED", "MUTED"]);
export const adminReportStatusSchema = z.enum(["PENDING", "REJECTED", "RESOLVED"]);
export const adminAiReviewStatusSchema = z.enum(["FALLBACK", "SUCCEEDED"]);
export const adminSignalSourceSchema = z.enum(["ai_generated", "human", "seed"]);
const adminListLimitSchema = z.coerce.number().int().min(1).max(100).optional();
const adminCursorSchema = z.string().trim().min(1).max(512).optional();
const adminSearchSchema = z.string().trim().min(1).max(200).optional();
export const adminProviderConfigKindSchema = z.enum([
  "chat",
  "embedding",
  "reranker",
  "tts",
]);

export const adminUserStatusQuerySchema = z.object({
  status: adminUserStatusSchema.optional(),
});

export const adminReportStatusQuerySchema = z.object({
  status: adminReportStatusSchema.optional(),
});

export const adminAiReviewQuerySchema = z.object({
  reviewType: z.string().trim().min(1).max(80).optional(),
  status: adminAiReviewStatusSchema.optional(),
});

export const adminSignalQuerySchema = z.object({
  cursor: adminCursorSchema,
  limit: adminListLimitSchema,
  q: adminSearchSchema,
  source: adminSignalSourceSchema.optional(),
  status: adminSignalStatusSchema.optional(),
});

export const adminAiSignalQuerySchema = z.object({
  cursor: adminCursorSchema,
  limit: adminListLimitSchema,
  q: adminSearchSchema,
  source: adminSignalSourceSchema.optional(),
});

export const adminGenerateSignalsBodySchema = z.object({
  count: z.number().int().min(1).max(10).optional(),
});

export const adminKeepSignalBodySchema = z.object({
  isKept: z.boolean(),
});

export const adminIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminProviderConfigParamsSchema = z.object({
  kind: adminProviderConfigKindSchema,
});

export const adminProviderConfigIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminProviderConfigTestQuerySchema = z.object({
  environment: z.enum(["1"]).optional(),
  id: z.string().uuid().optional(),
});

export const adminSignalStatusBodySchema = z.object({
  status: adminSignalStatusSchema,
});

export const adminUserStatusBodySchema = z.object({
  status: adminUserStatusSchema,
});

export const adminReportResolutionBodySchema = z.object({
  resolution: z.string().trim().min(2).max(500).optional(),
  status: z.enum(["REJECTED", "RESOLVED"]),
});

const adminProviderExtraJsonSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .default({});

export const adminProviderConfigBodySchema = z
  .object({
    apiKey: z.string().trim().max(4000).optional(),
    baseUrl: z.union([z.string().trim().url(), z.literal("")]),
    clearApiKey: z.boolean().optional(),
    extraJson: adminProviderExtraJsonSchema.optional(),
    isEnabled: z.boolean().optional(),
    kind: adminProviderConfigKindSchema.optional(),
    model: z.string().trim().min(1).max(160),
    priority: z.number().int().min(1).max(999).optional(),
    provider: z.string().trim().min(1).max(80),
  })
  .refine((value) => !(value.apiKey && value.clearApiKey), {
    message: "apiKey and clearApiKey cannot be used together.",
    path: ["apiKey"],
  });

export type AdminSignalStatus = z.infer<typeof adminSignalStatusSchema>;
export type AdminUserStatus = z.infer<typeof adminUserStatusSchema>;
export type AdminReportStatus = z.infer<typeof adminReportStatusSchema>;
export type AdminAiReviewStatus = z.infer<typeof adminAiReviewStatusSchema>;
export type AdminSignalSource = z.infer<typeof adminSignalSourceSchema>;
export type AdminProviderConfigKind = z.infer<typeof adminProviderConfigKindSchema>;
export type AdminUserStatusQuery = z.infer<typeof adminUserStatusQuerySchema>;
export type AdminReportStatusQuery = z.infer<typeof adminReportStatusQuerySchema>;
export type AdminAiReviewQuery = z.infer<typeof adminAiReviewQuerySchema>;
export type AdminSignalQuery = z.infer<typeof adminSignalQuerySchema>;
export type AdminAiSignalQuery = z.infer<typeof adminAiSignalQuerySchema>;
export type AdminIdParams = z.infer<typeof adminIdParamsSchema>;
export type AdminProviderConfigParams = z.infer<typeof adminProviderConfigParamsSchema>;
export type AdminProviderConfigIdParams = z.infer<typeof adminProviderConfigIdParamsSchema>;
export type AdminProviderConfigTestQuery = z.infer<typeof adminProviderConfigTestQuerySchema>;
export type AdminSignalStatusBody = z.infer<typeof adminSignalStatusBodySchema>;
export type AdminUserStatusBody = z.infer<typeof adminUserStatusBodySchema>;
export type AdminReportResolutionBody = z.infer<typeof adminReportResolutionBodySchema>;
export type AdminGenerateSignalsBody = z.infer<typeof adminGenerateSignalsBodySchema>;
export type AdminKeepSignalBody = z.infer<typeof adminKeepSignalBodySchema>;
export type AdminProviderConfigBody = z.infer<typeof adminProviderConfigBodySchema>;
