import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import { frontendDiagnosticBodySchema } from "./schemas.js";

export async function frontendDiagnosticRoutes(app: FastifyInstance) {
  app.post("/errors", async (request, reply) => {
    const parsedBody = frontendDiagnosticBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const diagnostic = parsedBody.data;

    request.log.warn(
      {
        action: "frontend.error.report",
        correlationId: diagnostic.correlationId,
        digest: diagnostic.digest,
        errorMessage: diagnostic.message,
        errorName: diagnostic.name,
        frontendRequestId: diagnostic.requestId,
        requestId: request.id,
        route: diagnostic.route,
        source: diagnostic.source,
      },
      "frontend diagnostic received",
    );

    return sendData(
      reply,
      request,
      {
        accepted: true,
        correlationId: diagnostic.correlationId,
      },
      202,
    );
  });
}
