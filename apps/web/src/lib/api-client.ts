import { env } from "./env";
import type { ApiErrorResponse, ApiResponse } from "@unfreq/contracts/api";

type RequestBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type ApiResponseValidator<TData> = (value: unknown) => value is TData;

type RequestOptions<TBody extends RequestBody | undefined, TData> = {
  body?: TBody;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  signal?: AbortSignal;
  timeoutMs?: number;
  validate?: ApiResponseValidator<TData>;
};

export class ApiClientError extends Error {
  code: string;
  details?: unknown;
  requestId?: string;
  status: number;

  constructor(params: {
    code: string;
    details?: unknown;
    message: string;
    requestId?: string;
    status: number;
  }) {
    super(params.message);
    this.name = "ApiClientError";
    this.code = params.code;
    this.details = params.details;
    this.requestId = params.requestId;
    this.status = params.status;
  }
}

export function isApiUnavailableError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 0 &&
    error.code === "NETWORK_ERROR"
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const isApiErrorResponse = (value: unknown): value is ApiErrorResponse => {
  if (!isRecord(value) || !isRecord(value.error) || !isRecord(value.meta)) {
    return false;
  }

  return (
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.meta.requestId === "string"
  );
};

const hasApiDataEnvelope = (value: unknown): value is ApiResponse<unknown> => {
  if (!isRecord(value) || !isRecord(value.meta)) {
    return false;
  }

  return "data" in value && typeof value.meta.requestId === "string";
};

const toUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiBaseUrl =
    typeof window === "undefined" ? env.serverApiBaseUrl : env.publicApiBaseUrl;
  const pathWithoutDuplicatedApiPrefix =
    apiBaseUrl.endsWith("/api") && normalizedPath.startsWith("/api/")
      ? normalizedPath.slice("/api".length)
      : normalizedPath;

  return `${apiBaseUrl}${pathWithoutDuplicatedApiPrefix}`;
};

const request = async <TData, TBody extends RequestBody | undefined = undefined>(
  path: string,
  options: RequestOptions<TBody, TData> = {},
): Promise<TData> => {
  const headers = new Headers(options.headers);

  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  const requestSignal =
    options.signal ??
    (options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs));

  try {
    response = await fetch(toUrl(path), {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: options.cache,
      credentials: options.credentials ?? "include",
      headers,
      method: options.method ?? "GET",
      signal: requestSignal,
    });
  } catch (caughtError) {
    throw new ApiClientError({
      code: "NETWORK_ERROR",
      details: caughtError instanceof Error ? caughtError.message : undefined,
      message: "API request failed before a response was received.",
      status: 0,
    });
  }

  const payload = await readJson(response);

  if (!response.ok) {
    if (isApiErrorResponse(payload)) {
      throw new ApiClientError({
        code: payload.error.code,
        details: payload.error.details,
        message: payload.error.message,
        requestId: payload.meta.requestId,
        status: response.status,
      });
    }

    throw new ApiClientError({
      code: "HTTP_ERROR",
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }

  if (!hasApiDataEnvelope(payload)) {
    throw new ApiClientError({
      code: "INVALID_RESPONSE",
      message: "API response did not match the expected envelope.",
      status: response.status,
    });
  }

  if (options.validate !== undefined && !options.validate(payload.data)) {
    throw new ApiClientError({
      code: "INVALID_RESPONSE",
      details: { path },
      message: "API response data did not match the expected contract.",
      requestId: payload.meta.requestId,
      status: response.status,
    });
  }

  return payload.data as TData;
};

export const apiClient = {
  delete: <TData, TBody extends RequestBody | undefined = undefined>(
    path: string,
    options?: Omit<RequestOptions<TBody, TData>, "method">,
  ) => {
    return request<TData, TBody>(path, { ...options, method: "DELETE" });
  },
  get: <TData>(path: string, options?: Omit<RequestOptions<undefined, TData>, "method">) => {
    return request<TData>(path, { ...options, method: "GET" });
  },
  patch: <TData, TBody extends RequestBody>(
    path: string,
    body: TBody,
    options?: Omit<RequestOptions<TBody, TData>, "body" | "method">,
  ) => {
    return request<TData, TBody>(path, { ...options, body, method: "PATCH" });
  },
  post: <TData, TBody extends RequestBody>(
    path: string,
    body: TBody,
    options?: Omit<RequestOptions<TBody, TData>, "body" | "method">,
  ) => {
    return request<TData, TBody>(path, { ...options, body, method: "POST" });
  },
  put: <TData, TBody extends RequestBody>(
    path: string,
    body: TBody,
    options?: Omit<RequestOptions<TBody, TData>, "body" | "method">,
  ) => {
    return request<TData, TBody>(path, { ...options, body, method: "PUT" });
  },
};
