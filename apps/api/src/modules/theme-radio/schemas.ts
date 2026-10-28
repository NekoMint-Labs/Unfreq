import { z } from "zod";

export const themeRadioDaySchema = z.object({
  createdAt: z.string(),
  description: z.string().optional(),
  endsAt: z.string().optional(),
  id: z.string().uuid(),
  isActive: z.boolean(),
  startsAt: z.string(),
  theme: z.string().min(1).max(48),
  title: z.string().min(1).max(80),
  updatedAt: z.string(),
});

export const themeRadioDayResponseSchema = z.object({
  themeRadioDay: themeRadioDaySchema.optional(),
});

export const themeRadioDaysResponseSchema = z.object({
  themeRadioDays: z.array(themeRadioDaySchema),
});

export const createThemeRadioDayBodySchema = z.object({
  description: z.string().trim().min(1).max(240).optional(),
  endsAt: z.string().datetime().optional(),
  startsAt: z.string().datetime().optional(),
  theme: z.string().trim().min(1).max(48),
  title: z.string().trim().min(1).max(80),
});

export type CreateThemeRadioDayBody = z.infer<typeof createThemeRadioDayBodySchema>;
