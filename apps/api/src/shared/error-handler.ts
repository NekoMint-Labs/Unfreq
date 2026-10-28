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
  if (isAppError(error)) {
    request.log.warn(
      {
        code: error.code,
        details: error.details,
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
      err: error,
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
