import type { FastifyBaseLogger } from "fastify";
import { generateAiSignals } from "./service.js";

const dayMs = 24 * 60 * 60 * 1000;

function msUntilNextThreeAm(now = new Date()): number {
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

export function startAiSignalScheduler(logger: FastifyBaseLogger) {
  let interval: NodeJS.Timeout | undefined;

  const run = () => {
    void generateAiSignals({ logger }).catch((error) => {
      logger.warn(
        {
          action: "signal.ai_content.scheduler_failed",
          err: error,
        },
        "ai signal scheduler failed",
      );
    });
  };

  const initialTimeout = setTimeout(() => {
    run();
    interval = setInterval(run, dayMs);
    interval.unref();
  }, msUntilNextThreeAm());

  initialTimeout.unref();

  return () => {
    clearTimeout(initialTimeout);

    if (interval !== undefined) {
      clearInterval(interval);
    }
  };
}
