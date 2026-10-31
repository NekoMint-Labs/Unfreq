import { AppError, toSafeAiFailureDetails } from "../../shared/errors.js";
import { safeErrorType } from "../../shared/log-redaction.js";

export function toSafeErrorReason(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }

  return safeErrorType(error);
}

export function toSafeAiErrorFailureDetails(error: unknown) {
  return error instanceof AppError ? toSafeAiFailureDetails(error.details) : undefined;
}
