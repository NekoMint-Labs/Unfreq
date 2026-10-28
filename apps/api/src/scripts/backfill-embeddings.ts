import { closeDatabaseConnection } from "../db/client.js";
import {
  generateEmbedding,
  isEmbeddingProviderConfigured,
} from "../modules/ai/embedding.js";
import {
  listSignalsMissingEmbedding,
  writeSignalEmbeddingIfMissing,
} from "../modules/signals/repository.js";
import { buildSignalEmbeddingText } from "../modules/signals/service.js";

type BackfillStats = {
  failed: number;
  skipped: number;
  succeeded: number;
  total: number;
};

type BackfillLogger = {
  error: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

const defaultLimit = 100;

const logger: BackfillLogger = {
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

function parseLimit(argv: string[]): number {
  const rawLimit = argv
    .find((item) => item.startsWith("--limit="))
    ?.slice("--limit=".length);

  if (rawLimit === undefined || rawLimit.length === 0) {
    return defaultLimit;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("--limit must be an integer between 1 and 1000.");
  }

  return limit;
}

function toReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

async function backfillEmbeddings(limit: number): Promise<BackfillStats> {
  if (!(await isEmbeddingProviderConfigured())) {
    throw new Error("Embedding provider is not configured.");
  }

  const signals = await listSignalsMissingEmbedding(limit);
  const stats: BackfillStats = {
    failed: 0,
    skipped: 0,
    succeeded: 0,
    total: signals.length,
  };

  logger.info(
    {
      action: "signal.embedding.backfill",
      limit,
      total: signals.length,
    },
    "signal embedding backfill started",
  );

  for (const signal of signals) {
    try {
      const embedding = await generateEmbedding(
        buildSignalEmbeddingText({
          expandedText: signal.expandedText,
          fingerprint: signal.fingerprintJson,
        }),
        {
          logger,
        },
      );
      const written = await writeSignalEmbeddingIfMissing({
        dimensions: embedding.dimensions,
        embedding: embedding.embedding,
        model: embedding.model,
        provider: embedding.provider,
        version: embedding.version,
        id: signal.id,
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
          action: "signal.embedding.backfill.item_failed",
          reason: toReason(error),
          targetId: signal.id,
          targetType: "SIGNAL",
        },
        "signal embedding backfill item failed",
      );
    }
  }

  logger.info(
    {
      action: "signal.embedding.backfill",
      failed: stats.failed,
      skipped: stats.skipped,
      succeeded: stats.succeeded,
      total: stats.total,
    },
    "signal embedding backfill completed",
  );

  return stats;
}

try {
  const stats = await backfillEmbeddings(parseLimit(process.argv.slice(2)));
  process.exitCode = stats.failed > 0 ? 1 : 0;
} catch (error) {
  logger.error(
    {
      action: "signal.embedding.backfill",
      reason: toReason(error),
    },
    "signal embedding backfill failed",
  );
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
