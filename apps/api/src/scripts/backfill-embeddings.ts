import { closeDatabaseConnection } from "../db/client.js";
import { embeddingBackfillPlan, parseBackfillOptions } from "../modules/ai/embedding-backfill-plan.js";
import { resolveEmbeddingProviderConfigs } from "../modules/ai/provider-config.js";
import {
  generateEmbedding,
  isEmbeddingProviderConfigured,
} from "../modules/ai/embedding.js";
import {
  listSignalsMissingEmbedding,
  recheckPublicSignals,
  writeSignalEmbeddingIfMissing,
} from "../modules/signals/repository.js";
import { buildSignalEmbeddingText } from "../modules/signals/service-embedding.js";

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

function toReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}

async function backfillEmbeddings(options: ReturnType<typeof parseBackfillOptions>): Promise<BackfillStats> {
  const configs = (await resolveEmbeddingProviderConfigs()).filter((config) => config.apiKey.length > 0 && config.baseUrl.length > 0);
  if (configs.length === 0 || !(await isEmbeddingProviderConfigured(configs[0]))) {
    throw new Error("Embedding provider is not configured.");
  }

  const signals = await listSignalsMissingEmbedding(options.limit);
  const stats: BackfillStats = {
    failed: 0,
    skipped: 0,
    succeeded: 0,
    total: signals.length,
  };

  logger.info({ action: "signal.embedding.backfill.plan", mode: options.apply ? "apply" : "dry-run",
    ...embeddingBackfillPlan(signals, configs) }, "embedding backfill scope and accounting bounds");
  if (!options.apply) return stats;

  logger.info(
    {
      action: "signal.embedding.backfill",
      limit: options.limit,
      total: signals.length,
    },
    "signal embedding backfill started",
  );

  for (const signal of signals) {
    try {
      const [current] = await recheckPublicSignals([{ id: signal.id, publicationVersion: signal.publicationVersion }]);
      if (current === undefined || current.expandedText !== signal.expandedText) { stats.skipped += 1; continue; }
      const embedding = await generateEmbedding(
        buildSignalEmbeddingText({
          expandedText: signal.expandedText,
          fingerprint: signal.fingerprintJson,
        }),
        {
          configs,
          purpose: "backfill",
          logger,
        },
      );
      const written = await writeSignalEmbeddingIfMissing({
        expectedExpandedText: signal.expandedText,
        expectedPublicationVersion: signal.publicationVersion,
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
  const stats = await backfillEmbeddings(parseBackfillOptions(process.argv.slice(2)));
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
