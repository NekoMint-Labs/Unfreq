import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import { createReportBodySchema } from "./schemas.js";
import { createReport } from "./service.js";

export async function reportRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const frequency = request.requireFrequency();
    const parsedBody = createReportBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const report = await createReport(frequency, parsedBody.data);

    request.log.info(
      {
        action: "report.create",
        freqCode: frequency.freqCode,
        requestId: request.id,
        targetId: report.targetId,
        targetType: report.targetType,
        userId: frequency.id,
      },
      "report created",
    );

    return sendData(reply, request, { report }, 201);
  });
}
