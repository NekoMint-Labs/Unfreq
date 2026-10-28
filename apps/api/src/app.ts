import cors from "@fastify/cors";
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
import { closeAbuseControl } from "./shared/abuse-control.js";
import { safeRequestId } from "./shared/request-identity.js";
import { apiShutdownBudgetMs } from "./shared/shutdown-budget.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { signalRoutes } from "./modules/signals/routes.js";
import { startAiSignalScheduler } from "./modules/signals/scheduler.js";
import { createSignalGenerationWorker, type GenerationWorkerOptions, type SignalGenerationWorker } from "./modules/signals/generation-worker.js";
import { createSignalAudioWorker, type SignalAudioWorkerOptions, type SignalAudioWorker } from "./modules/signals/audio-worker.js";
import { adminThemeRadioRoutes, themeRadioRoutes } from "./modules/theme-radio/routes.js";

type BuildAppOptions = {
  logger?: FastifyServerOptions<RawServerDefault>["logger"];
  generationWorkerFactory?: (options: GenerationWorkerOptions) => SignalGenerationWorker;
  audioWorkerFactory?: (options: SignalAudioWorkerOptions) => SignalAudioWorker;
  onGenerationFatal?: () => void | Promise<void>;
  onAudioFatal?: () => void | Promise<void>;
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
    redact: {
      paths: ["authorization", "cookie", "password", "sessionToken", "apiKey", "loginChallengeCode",
        "req.headers.authorization", "req.headers.cookie", "headers.authorization", "headers.cookie",
        "body.password", "body.code", "*.password", "*.sessionToken", "*.apiKey"],
      censor: "[redacted]",
    },
  };
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify<RawServerDefault>({
    disableRequestLogging: true,
    trustProxy: env.trustedProxyCidrs.length === 0 ? false : env.trustedProxyCidrs,
    genReqId: (request) => safeRequestId(request.headers["x-request-id"]),
    logger: resolveLoggerOptions(options),
  });

  app.setErrorHandler(errorHandler);

  const generationWorker = (options.generationWorkerFactory ?? createSignalGenerationWorker)({
    logger: app.log,
    forceCloseApplicationDatabase: () => closeDatabaseConnection({ timeoutSeconds: 0 }),
    onFatal: () => options.onGenerationFatal === undefined ? app.close() : options.onGenerationFatal(),
  });
  const audioWorker = (options.audioWorkerFactory ?? createSignalAudioWorker)({
    logger: app.log,
    shutdownBudgetMs: apiShutdownBudgetMs(env),
    forceCloseApplicationDatabase: () => closeDatabaseConnection({ timeoutSeconds: 0 }),
    onFatal: () => {
      const fatal = options.onAudioFatal ?? options.onGenerationFatal;
      return fatal === undefined ? app.close() : fatal();
    },
  });
  let stopAiSignalScheduler: (() => void) | undefined;

  app.addHook("onReady", async () => { generationWorker.start(); });
  // Stop consumers while PostgreSQL is still open. The preClose stage precedes
  // the existing plugin onClose hooks, including Redis and the primary pool.
  app.addHook("preClose", async () => {
    stopAiSignalScheduler?.();
    const stopped = await Promise.allSettled([generationWorker.stop(), audioWorker.stop()]);
    const failed = stopped.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });

  app.addHook("onClose", async () => {
    await closeAbuseControl();
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
  await app.register(signalRoutes, { prefix: "/api/signals", generationWorker, audioWorker });
  await app.register(monthlyRecapRoutes, { prefix: "/api/me/recaps" });
  await app.register(themeRadioRoutes, { prefix: "/api/theme-radio" });
  await app.register(imageRoutes, { prefix: "/api/images" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(adminThemeRadioRoutes, { prefix: "/api/admin/theme-radio-days" });

  return app;
}
