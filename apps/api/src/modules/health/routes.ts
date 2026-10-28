import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { checkDatabaseConnection } from "../../db/client.js";
import { checkRedisConnection } from "../../plugins/redis.js";
import { sendData } from "../../shared/response.js";

type DependencyStatus = "ok" | "unavailable";

type DeepHealthData = {
  dependencies: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
  };
  service: "api";
  status: "ok" | "unavailable";
  timestamp: string;
  uptimeSeconds: number;
};

const getDependencyStatus = async (check: () => Promise<void>) => {
  try {
    await withTimeout(check, env.healthDependencyTimeoutMs);
    return "ok" satisfies DependencyStatus;
  } catch {
    return "unavailable" satisfies DependencyStatus;
  }
};

const withTimeout = async (check: () => Promise<void>, timeoutMs: number) => {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Dependency check timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (request, reply) => {
    return sendData(reply, request, {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get("/health/deep", async (request, reply) => {
    const [postgres, redis] = await Promise.all([
      getDependencyStatus(checkDatabaseConnection),
      getDependencyStatus(() => checkRedisConnection(app.redis)),
    ]);

    const data: DeepHealthData = {
      dependencies: {
        postgres,
        redis,
      },
      service: "api",
      status: postgres === "ok" && redis === "ok" ? "ok" : "unavailable",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };

    return sendData(reply, request, data, data.status === "ok" ? 200 : 503);
  });
}
