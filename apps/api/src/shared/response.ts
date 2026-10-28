import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "@unfreq/contracts/api";
import type { AppErrorCode } from "./errors.js";

export type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "@unfreq/contracts/api";

export function sendData<TData>(
  reply: FastifyReply,
  request: FastifyRequest,
  data: TData,
  statusCode = 200,
) {
  const payload: ApiSuccessResponse<TData> = {
    data,
    meta: {
      requestId: request.id,
    },
  };

  return reply.code(statusCode).send(payload);
}

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  params: {
    code: AppErrorCode;
    details?: unknown;
    message: string;
    statusCode: number;
  },
) {
  const payload: ApiErrorResponse = {
    error: {
      code: params.code,
      details: params.details,
      message: params.message,
    },
    meta: {
      requestId: request.id,
    },
  };

  return reply.code(params.statusCode).send(payload);
}
