import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { closeDatabaseConnection } from "./db/client.js";

let shutdownPromise: Promise<void> | undefined;

function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (exitCode !== 0) process.exitCode = exitCode;
  shutdownPromise ??= (async () => {
    // Kept unref'ed after a clean close: it does not keep an idle server alive,
    // but any remaining socket/timer cannot postpone process exit forever.
    const budget = env.signalGenerationShutdownGraceMs +
      2 * (env.signalGenerationDbStatementTimeoutMs + env.signalGenerationDbLockTimeoutMs + 1000) + 5000;
    const watchdog = setTimeout(() => {
      app.log.error({ action: "api.shutdown.deadline" }, "api shutdown exceeded its resource drain budget");
      process.exit(1);
    }, budget);
    watchdog.unref();
    try {
      app.log.info({ reason }, "api server shutting down");
      await app.close();
    } catch {
      app.log.error({ action: "api.shutdown.failed" }, "api shutdown requires process restart");
      await closeDatabaseConnection({ timeoutSeconds: 0 }).catch(() => {});
      process.exitCode = 1;
    }
    if (process.exitCode === 1) process.exit(1);
  })();
  return shutdownPromise;
}

const app = await buildApp({ onGenerationFatal: () => shutdown("GENERATION_FATAL", 1) });

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: env.apiHost,
    port: env.apiPort,
  });
} catch (error) {
  app.log.error({ err: error }, "api server failed to start");
  await shutdown("LISTEN_FAILED", 1);
}
