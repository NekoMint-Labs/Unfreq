export type AppErrorCode =
  | "AI_UNAVAILABLE"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export type ApiResponse<TData> = {
  data: TData;
  meta: {
    requestId: string;
  };
};

export type ApiSuccessResponse<TData> = ApiResponse<TData>;

export type ApiErrorResponse = {
  error: {
    code: AppErrorCode;
    details?: unknown;
    message: string;
  };
  meta: {
    requestId: string;
  };
};
