import type {
  AppErrorCode,
} from "@unfreq/contracts/api";

export type {
  AppErrorCode,
} from "@unfreq/contracts/api";

const statusByCode: Record<AppErrorCode, number> = {
  AI_UNAVAILABLE: 503,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
};

export class AppError extends Error {
  code: AppErrorCode;
  details?: unknown;
  statusCode: number;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.statusCode = statusByCode[code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export type SafeAiFailureDetails = {
  failureBoundary?: string;
  failureFallbackBoundary?: string;
  failureKind?: string;
  failureProviderAttemptCount?: number;
  failureStatusCode?: number;
  failureTimeoutMs?: number;
  failureType?: string;
};

export function toSafeAiFailureDetails(details: unknown): SafeAiFailureDetails | undefined {
  if (typeof details !== "object" || details === null) {
    return undefined;
  }

  const fields = details as Record<string, unknown>;

  return {
    failureBoundary:
      typeof fields.boundary === "string" && fields.boundary.length > 0
        ? fields.boundary
        : undefined,
    failureFallbackBoundary:
      typeof fields.fallbackBoundary === "string" && fields.fallbackBoundary.length > 0
        ? fields.fallbackBoundary
        : undefined,
    failureKind:
      typeof fields.kind === "string" && fields.kind.length > 0 ? fields.kind : undefined,
    failureProviderAttemptCount:
      typeof fields.providerAttemptCount === "number" &&
      Number.isFinite(fields.providerAttemptCount)
        ? fields.providerAttemptCount
        : undefined,
    failureStatusCode:
      typeof fields.statusCode === "number" && Number.isFinite(fields.statusCode)
        ? fields.statusCode
        : undefined,
    failureTimeoutMs:
      typeof fields.timeoutMs === "number" && Number.isFinite(fields.timeoutMs)
        ? fields.timeoutMs
        : undefined,
    failureType:
      typeof fields.type === "string" && fields.type.length > 0 ? fields.type : undefined,
  };
}
