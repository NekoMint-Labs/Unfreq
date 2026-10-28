import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export const loggerPlugin = fp(async function loggerPlugin(app: FastifyInstance) {
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        durationMs: Math.round(reply.elapsedTime),
        method: request.method,
        requestId: request.id,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
      },
      "request completed",
    );
  });
});
