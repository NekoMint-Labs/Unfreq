import { closeDatabaseConnection } from "../db/client.js";
import { seedSignalLibrary } from "../modules/signals/service.js";

type ScriptLogger = {
  error: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

const logger: ScriptLogger = {
  error(fields, message) {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  },
  info(fields, message) {
    console.info(JSON.stringify({ level: "info", message, ...fields }));
  },
  warn(fields, message) {
    console.warn(JSON.stringify({ level: "warn", message, ...fields }));
  },
};

function toReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

try {
  const result = await seedSignalLibrary({ logger });

  logger.info(
    {
      accepted: result.accepted,
      action: "signal.seed_library.script",
      attempts: result.attempts,
      rejected: result.rejected,
    },
    "signal seed script completed",
  );
  process.exitCode = result.rejected > 0 ? 1 : 0;
} catch (error) {
  logger.error(
    {
      action: "signal.seed_library.script",
      reason: toReason(error),
    },
    "signal seed script failed",
  );
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
