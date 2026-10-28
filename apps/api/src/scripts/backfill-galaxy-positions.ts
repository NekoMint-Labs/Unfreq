import { closeDatabaseConnection } from "../db/client.js";
import {
  listSignalsMissingGalaxyPosition,
  writeSignalGalaxyPositionIfMissing,
} from "../modules/signals/repository.js";
import { buildStableGalaxyPosition } from "../modules/signals/service.js";

type BackfillStats = {
  failed: number;
  skipped: number;
  succeeded: number;
  total: number;
};

const defaultLimit = 1000;

const logger = {
  error(fields: Record<string, unknown>, message: string) {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  },
  info(fields: Record<string, unknown>, message: string) {
    console.info(JSON.stringify({ level: "info", message, ...fields }));
  },
  warn(fields: Record<string, unknown>, message: string) {
    console.warn(JSON.stringify({ level: "warn", message, ...fields }));
  },
};

function parseLimit(argv: string[]): number {
  const rawLimit = argv
    .find((item) => item.startsWith("--limit="))
    ?.slice("--limit=".length);

  if (rawLimit === undefined || rawLimit.length === 0) {
    return defaultLimit;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("--limit must be an integer between 1 and 10000.");
  }

  return limit;
}

function toReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

async function backfillGalaxyPositions(limit: number): Promise<BackfillStats> {
  const signals = await listSignalsMissingGalaxyPosition(limit);
  const stats: BackfillStats = {
    failed: 0,
    skipped: 0,
    succeeded: 0,
    total: signals.length,
  };

  logger.info(
    {
      action: "signal.galaxy_position.backfill",
      limit,
      total: signals.length,
    },
    "signal galaxy position backfill started",
  );

  for (const signal of signals) {
    try {
      const written = await writeSignalGalaxyPositionIfMissing({
        id: signal.id,
        position: buildStableGalaxyPosition(signal),
      });

      if (written) {
        stats.succeeded += 1;
      } else {
        stats.skipped += 1;
      }
    } catch (error) {
      stats.failed += 1;
      logger.warn(
        {
          action: "signal.galaxy_position.backfill.item_failed",
          reason: toReason(error),
          targetId: signal.id,
          targetType: "SIGNAL",
        },
        "signal galaxy position backfill item failed",
      );
    }
  }

  logger.info(
    {
      action: "signal.galaxy_position.backfill",
      failed: stats.failed,
      skipped: stats.skipped,
      succeeded: stats.succeeded,
      total: stats.total,
    },
    "signal galaxy position backfill completed",
  );

  return stats;
}

try {
  await backfillGalaxyPositions(parseLimit(process.argv.slice(2)));
} catch (error) {
  logger.error(
    {
      action: "signal.galaxy_position.backfill",
      reason: toReason(error),
    },
    "signal galaxy position backfill failed",
  );
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
