import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const frequencyCodeSchema = z.string().trim().min(5).max(16);
const legacyFrequencyNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9_-]{2,31}$/);
const loginCodeSchema = z.string().trim().regex(/^\d{6}$/);
const passwordSchema = z.string().min(8).max(128);

export const loginRequestBodySchema = z.object({
  email: emailSchema,
});

export const loginVerifyBodySchema = z.object({
  code: loginCodeSchema,
  email: emailSchema,
});

export const saveFrequencyBodySchema = z.object({
  frequencyName: legacyFrequencyNameSchema,
  password: passwordSchema,
});

export const registerFrequencyBodySchema = z.object({
  password: passwordSchema,
});

export const frequencyLoginBodySchema = z.object({
  frequencyCode: frequencyCodeSchema,
  password: passwordSchema,
});

export const frequencyNameSuggestionsBodySchema = z.object({
  context: z.string().trim().max(240).optional(),
});

export type LoginRequestBody = z.infer<typeof loginRequestBodySchema>;
export type LoginVerifyBody = z.infer<typeof loginVerifyBodySchema>;
export type RegisterFrequencyBody = z.infer<typeof registerFrequencyBodySchema>;
export type FrequencyLoginBody = z.infer<typeof frequencyLoginBodySchema>;
