import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyServerOptions, type RawServerDefault } from "fastify";
import { env } from "./config/env.js";
import { closeDatabaseConnection } from "./db/client.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { authRoutes, frequencyRoutes, meRoutes } from "./modules/auth/routes.js";
import { frontendDiagnosticRoutes } from "./modules/frontend-diagnostics/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { imageRoutes } from "./modules/images/routes.js";
import { monthlyRecapRoutes } from "./modules/monthly-recaps/routes.js";
import { authPlugin } from "./plugins/auth.js";
import { loggerPlugin } from "./plugins/logger.js";
import { redisPlugin } from "./plugins/redis.js";
import { errorHandler } from "./shared/error-handler.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { signalRoutes } from "./modules/signals/routes.js";
import { startAiSignalScheduler } from "./modules/signals/scheduler.js";
import { createSignalGenerationWorker, type GenerationWorkerOptions, type SignalGenerationWorker } from "./modules/signals/generation-worker.js";
import { adminThemeRadioRoutes, themeRadioRoutes } from "./modules/theme-radio/routes.js";

type BuildAppOptions = {
  logger?: FastifyServerOptions<RawServerDefault>["logger"];
  generationWorkerFactory?: (options: GenerationWorkerOptions) => SignalGenerationWorker;
  onGenerationFatal?: () => void | Promise<void>;
};

const resolveLoggerOptions = (options: BuildAppOptions) => {
  if (options.logger !== undefined) {
    return options.logger;
  }

  if (env.isTest) {
    return false;
  }

  return {
    level: env.logLevel,
  };
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify<RawServerDefault>({
    disableRequestLogging: true,
    genReqId: (request) => {
      const incomingRequestId = request.headers["x-request-id"];
      if (Array.isArray(incomingRequestId)) {
        return incomingRequestId[0] ?? randomUUID();
      }

      return incomingRequestId ?? randomUUID();
    },
    logger: resolveLoggerOptions(options),
  });

  app.setErrorHandler(errorHandler);

  const generationWorker = (options.generationWorkerFactory ?? createSignalGenerationWorker)({
    logger: app.log,
    forceCloseApplicationDatabase: () => closeDatabaseConnection({ timeoutSeconds: 0 }),
    onFatal: () => options.onGenerationFatal === undefined ? app.close() : options.onGenerationFatal(),
  });
  let stopAiSignalScheduler: (() => void) | undefined;

  app.addHook("onReady", async () => { generationWorker.start(); });
  // Stop consumers while PostgreSQL is still open. The preClose stage precedes
  // the existing plugin onClose hooks, including Redis and the primary pool.
  app.addHook("preClose", async () => {
    stopAiSignalScheduler?.();
    await generationWorker.stop();
  });

  app.addHook("onClose", async () => {
    await closeDatabaseConnection();
  });

  if (!env.isTest) {
    stopAiSignalScheduler = startAiSignalScheduler(app.log);
  }

  await app.register(cors, {
    credentials: true,
    origin: env.webOrigin,
  });

  await app.register(loggerPlugin);
  await app.register(redisPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(frequencyRoutes, { prefix: "/api/frequencies" });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(frontendDiagnosticRoutes, { prefix: "/api/frontend-diagnostics" });
  await app.register(reportRoutes, { prefix: "/api/reports" });
  await app.register(signalRoutes, { prefix: "/api/signals", generationWorker });
  await app.register(monthlyRecapRoutes, { prefix: "/api/me/recaps" });
  await app.register(themeRadioRoutes, { prefix: "/api/theme-radio" });
  await app.register(imageRoutes, { prefix: "/api/images" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(adminThemeRadioRoutes, { prefix: "/api/admin/theme-radio-days" });

  return app;
}
