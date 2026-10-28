import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const app = await buildApp();

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, "api server shutting down");
  await app.close();
};

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
  process.exit(1);
}
