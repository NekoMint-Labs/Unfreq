import { AppError } from "../../shared/errors.js";

export type ChatProviderFailureKind =
  | "config_missing"
  | "http_error"
  | "invalid_json"
  | "invalid_response"
  | "network_error"
  | "timeout";

export type ChatProviderFailureBoundary = "provider_call" | "provider_config_resolution";

export type ChatProviderFailureDetails = {
  boundary: ChatProviderFailureBoundary;
  fallbackBoundary?: "provider_fallback";
  kind: ChatProviderFailureKind;
  providerAttemptCount?: number;
  statusCode?: number;
  timeoutMs?: number;
  type: string;
};

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createChatProviderError(
  message: string,
  details: ChatProviderFailureDetails,
): AppError {
  return new AppError("AI_UNAVAILABLE", message, details);
}

export function createChatProviderFallbackError(
  error: AppError,
  providerAttemptCount: number,
): AppError {
  const details = typeof error.details === "object" && error.details !== null
    ? error.details as Record<string, unknown>
    : {};

  return new AppError("AI_UNAVAILABLE", error.message, {
    ...details,
    fallbackBoundary: "provider_fallback",
    providerAttemptCount,
  });
}
