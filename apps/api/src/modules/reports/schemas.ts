import { z } from "zod";
import { reportStatuses } from "@unfreq/contracts";

export const reportTargetTypeSchema = z.enum(["USER", "SIGNAL"]);

export const createReportBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(2).max(80),
  targetId: z.string().uuid(),
  targetType: reportTargetTypeSchema,
});

export const reportStatusSchema = z.enum(["PENDING", "RESOLVED", "REJECTED"]);
export const reportSignalParamsSchema = z.object({ id: z.string().uuid() });
const reportReceiptSchema = z.object({
  id: z.string().uuid(), targetId: z.string().uuid(), targetType: z.literal("SIGNAL"),
  status: z.enum(reportStatuses), createdAt: z.string(), resolvedAt: z.string().optional(),
}).strict();
export const reportResponseSchema = z.object({ report: reportReceiptSchema }).strict();
export const signalReportResponseSchema = z.object({ report: reportReceiptSchema.optional() }).strict();

export type CreateReportBody = z.infer<typeof createReportBodySchema>;
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
