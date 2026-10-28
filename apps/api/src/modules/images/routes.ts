import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import { createImageBodySchema, imageIdParamsSchema } from "./schemas.js";
import { createImage, getImageDownload } from "./service.js";

export async function imageRoutes(app: FastifyInstance) {
  app.post(
    "/",
    {
      bodyLimit: env.imageMaxBytes * 2,
    },
    async (request, reply) => {
      const frequency = request.requireFrequency();
      const parsedBody = createImageBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
      }

      const image = await createImage(frequency, parsedBody.data);

      request.log.info(
        {
          action: "image.create",
          freqCode: frequency.freqCode,
          mimeType: image.mimeType,
          requestId: request.id,
          sizeBytes: image.sizeBytes,
          targetId: image.id,
          targetType: "IMAGE",
          userId: frequency.id,
        },
        "image uploaded",
      );

      return sendData(reply, request, { image }, 201);
    },
  );

  app.get("/:id", async (request, reply) => {
    const parsedParams = imageIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedParams.error.flatten());
    }

    const download = await getImageDownload(parsedParams.data.id);

    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("content-length", download.record.sizeBytes)
      .header("content-type", download.record.mimeType)
      .send(download.stream);
  });
}
