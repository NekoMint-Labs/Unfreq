import { z } from "zod";

export const imageMimeTypeSchema = z.enum([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const createImageBodySchema = z
  .object({
    altText: z.string().trim().min(1).max(120).optional(),
    contentBase64: z.string().trim().min(1),
    mimeType: imageMimeTypeSchema,
  })
  .strict();

export const imageIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateImageBody = z.infer<typeof createImageBodySchema>;
export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;
