import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { getAbuseGuard } from "../../shared/abuse-control.js";
import { getCanonicalClientIp } from "../../shared/request-identity.js";
import { AppError } from "../../shared/errors.js";
import { sendData } from "../../shared/response.js";
import { frontendDiagnosticBodySchema } from "./schemas.js";

export async function frontendDiagnosticRoutes(app: FastifyInstance) {
  app.post("/errors", { bodyLimit: 4 * 1024, async onRequest(request) {
    await getAbuseGuard().consume([{ rule: "diagnosticIp", identity: getCanonicalClientIp(request) },
      { rule: "diagnosticSite", identity: "site" }]);
  } }, async (request, reply) => {
    const parsedBody = frontendDiagnosticBodySchema.safeParse(request.body);

    if (!parsedBody.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid request.", parsedBody.error.flatten());
    }

    const diagnostic = parsedBody.data;
    const fingerprint = createHmac("sha256", env.sessionSecret).update("frontend-diagnostic:v1\0")
      .update(JSON.stringify(diagnostic)).digest("hex");

    request.log.warn(
      {
        action: "frontend.error.report",
        diagnosticFingerprint: fingerprint,
        messageLength: diagnostic.message.length,
        nameLength: diagnostic.name.length,
        routeLength: diagnostic.route.length,
        requestId: request.id,
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
