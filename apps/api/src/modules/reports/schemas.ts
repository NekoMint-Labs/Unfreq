import { z } from "zod";

export const reportTargetTypeSchema = z.enum(["USER", "SIGNAL"]);

export const createReportBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(2).max(80),
  targetId: z.string().uuid(),
  targetType: reportTargetTypeSchema,
});

export const reportStatusSchema = z.enum(["PENDING", "RESOLVED", "REJECTED"]);

export type CreateReportBody = z.infer<typeof createReportBodySchema>;
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
