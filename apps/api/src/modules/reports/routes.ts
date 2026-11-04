import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import { consumeAbuse } from "../../shared/abuse-control.js";
import { getCanonicalClientIp } from "../../shared/request-identity.js";
import { createReportBodySchema, reportSignalParamsSchema, reportResponseSchema, signalReportResponseSchema } from "./schemas.js";
import { createReport, getOwnSignalReport } from "./service.js";

export async function reportRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_request, reply) => { reply.header("cache-control", "private, no-store, max-age=0"); });
  app.get("/signal/:id", async (request, reply) => {
    const frequency = request.requireFrequency();
    await consumeAbuse([{ rule: "reportReadUser", identity: frequency.id }]);
    const params = reportSignalParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError("VALIDATION_ERROR", "Invalid request.");
    const report = await getOwnSignalReport(frequency, params.data.id);
    return sendData(reply, request, signalReportResponseSchema.parse({ report }));
  });
  app.post("/", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const frequency = request.requireFrequency();
    await consumeAbuse([
      { rule: "reportRequestUser", identity: frequency.id },
      { rule: "reportRequestIp", identity: getCanonicalClientIp(request) },
    ]);
    const parsedBody = createReportBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.");
    }

    const report = await createReport(frequency, parsedBody.data);

    request.log.info(
      {
        action: "report.create",
        requestId: request.id,
        targetId: report.targetId,
        targetType: report.targetType,
      },
      "report created",
    );

    return sendData(reply, request, reportResponseSchema.parse({ report }), 201);
  });
}
