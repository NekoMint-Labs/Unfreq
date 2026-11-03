import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { safeErrorType } from "../shared/log-redaction.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export const redisPlugin = fp(async function redisPlugin(app: FastifyInstance) {
  const redis = new Redis(env.redisUrl, {
    connectTimeout: env.healthDependencyTimeoutMs,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  app.decorate("redis", redis);

  redis.on("error", (error) => {
    app.log.warn({ action: "redis.connection.failed", errorType: safeErrorType(error) }, "redis connection error");
  });

  app.addHook("onClose", async () => {
    redis.disconnect();
  });
});

export async function checkRedisConnection(redis: Redis) {
  try {
    if (redis.status === "end" || redis.status === "wait") {
      await redis.connect();
    }

    await redis.ping();
  } catch (error) {
    redis.disconnect();
    throw error;
  }
}
