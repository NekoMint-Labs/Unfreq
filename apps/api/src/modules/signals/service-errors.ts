import { AppError, toSafeAiFailureDetails } from "../../shared/errors.js";

export function toSafeErrorReason(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

export function toSafeAiErrorFailureDetails(error: unknown) {
  return error instanceof AppError ? toSafeAiFailureDetails(error.details) : undefined;
}
