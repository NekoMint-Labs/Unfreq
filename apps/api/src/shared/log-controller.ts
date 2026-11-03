import { LogController, type FastifyReply, type FastifyRequest } from "fastify";

const streamErrorLogger = new LogController();

/** Preserve the pre-upgrade policy: quiet requests, visible real stream failures. */
export class ApiLogController extends LogController {
  constructor() {
    super({ disableRequestLogging: true });
  }

  override streamError(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply,
    metadata?: Record<string, unknown>,
  ): void {
    if ("code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    streamErrorLogger.streamError(error, request, reply, metadata);
  }
}
