import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { isAppError, toSafeAiFailureDetails } from "./errors.js";
import { sendError } from "./response.js";

type ValidationError = FastifyError & {
  validation?: unknown;
};

const hasValidationDetails = (error: FastifyError): error is ValidationError => {
  return "validation" in error;
};

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const errorName = error.name;
  if (isAppError(error)) {
    if (error.code === "RATE_LIMITED") {
      const details = error.details as { retryAfterSeconds?: unknown } | undefined;
      const requested = details?.retryAfterSeconds;
      const seconds = typeof requested === "number" && Number.isFinite(requested) && requested > 0
        ? Math.min(2_147_483_647, Math.max(1, Math.ceil(requested))) : 1;
      reply.header("retry-after", String(seconds));
    }
    request.log.warn(
      {
        code: error.code,
        ...toSafeAiFailureDetails(error.details),
        requestId: request.id,
        statusCode: error.statusCode,
      },
      "application error",
    );

    return sendError(reply, request, {
      code: error.code,
      details: error.details,
      message: error.message,
      statusCode: error.statusCode,
    });
  }

  if (hasValidationDetails(error)) {
    return sendError(reply, request, {
      code: "VALIDATION_ERROR",
      details: error.validation,
      message: "Invalid request.",
      statusCode: 400,
    });
  }

  request.log.error(
    {
      errorType: ["Error", "TypeError", "RangeError", "SyntaxError", "PostgresError", "FastifyError", "ZodError"].includes(errorName)
        ? errorName : "Error",
      requestId: request.id,
    },
    "unexpected api error",
  );

  return sendError(reply, request, {
    code: "INTERNAL_ERROR",
    message: "Unexpected server error.",
    statusCode: 500,
  });
}
