import { ApiClientError, apiClient } from "@/lib/api-client";

export type FrontendDiagnosticSource =
  | "client-runtime"
  | "route-error"
  | "service-worker-registration"
  | "unhandled-rejection";

type FrontendDiagnosticPayload = {
  correlationId: string;
  digest?: string;
  message: string;
  name: string;
  requestId?: string;
  route: string;
  source: FrontendDiagnosticSource;
};

type FrontendDiagnosticResponse = {
  accepted: boolean;
  correlationId: string;
};

type ReportFrontendErrorOptions = {
  digest?: string;
  route?: string;
};

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const secretPattern =
  /\b(cookie|session|token|authorization|bearer)\b\s*[:=]\s*[^\s;]+/gi;
const quotedLongTextPattern = /(["'`])[^"'`]{80,}\1/g;

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
};

const sanitizeDiagnosticText = (value: string, maxLength: number): string => {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(emailPattern, "[redacted-email]")
    .replace(secretPattern, "$1=[redacted-secret]")
    .replace(quotedLongTextPattern, "[redacted-text]")
    .trim();

  return truncate(normalized.length === 0 ? "Unknown frontend error." : normalized, maxLength);
};

const createCorrelationId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const getCurrentRoute = (): string => {
  if (typeof window === "undefined") {
    return "/";
  }

  return window.location.pathname || "/";
};

const getErrorDetails = (error: unknown): Pick<
  FrontendDiagnosticPayload,
  "message" | "name" | "requestId"
> => {
  if (error instanceof ApiClientError) {
    return {
      message: sanitizeDiagnosticText(error.message, 300),
      name: error.name,
      requestId: error.requestId,
    };
  }

  if (error instanceof Error) {
    return {
      message: sanitizeDiagnosticText(error.message, 300),
      name: sanitizeDiagnosticText(error.name, 120),
    };
  }

  if (typeof error === "string") {
    return {
      message: sanitizeDiagnosticText(error, 300),
      name: "Error",
    };
  }

  return {
    message: "Unknown frontend error.",
    name: "Error",
  };
};

export const reportFrontendError = async (
  source: FrontendDiagnosticSource,
  error: unknown,
  options: ReportFrontendErrorOptions = {},
) => {
  const errorDetails = getErrorDetails(error);
  const payload: FrontendDiagnosticPayload = {
    correlationId: createCorrelationId(),
    digest:
      options.digest === undefined
        ? undefined
        : sanitizeDiagnosticText(options.digest, 120),
    message: errorDetails.message,
    name: errorDetails.name,
    requestId: errorDetails.requestId,
    route: options.route ?? getCurrentRoute(),
    source,
  };

  if (process.env.NODE_ENV === "development") {
    console.info("[frontend-diagnostics]", payload);
  }

  try {
    await apiClient.post<FrontendDiagnosticResponse, FrontendDiagnosticPayload>(
      "/api/frontend-diagnostics/errors",
      payload,
      {
        credentials: "omit",
      },
    );
  } catch (diagnosticError) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[frontend-diagnostics] failed to send", diagnosticError);
    }
  }
};
