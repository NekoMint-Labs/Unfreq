import { z } from "zod";
import { mySignalSummarySchema } from "../signals/schemas.js";

export const monthlyRecapParamsSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
});

export const generateMonthlyRecapBodySchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u).optional(),
});

export const monthlyRecapDetailSchema = z.object({
  createdAt: z.string(),
  frequencyId: z.string().uuid(),
  generatedAt: z.string(),
  id: z.string().uuid(),
  signalCount: z.number().int().nonnegative(),
  summary: z.string().min(1).max(100),
  themeWords: z.array(z.string().min(1)).min(1).max(3),
  topSignal: mySignalSummarySchema.optional(),
  totalResonanceCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  yearMonth: z.string(),
});

export const monthlyRecapResponseSchema = z.object({
  recap: monthlyRecapDetailSchema,
});

export const latestMonthlyRecapResponseSchema = z.object({
  recap: monthlyRecapDetailSchema.optional(),
});

export type GenerateMonthlyRecapBody = z.infer<typeof generateMonthlyRecapBodySchema>;
