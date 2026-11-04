/** Shared by the process watchdog and the audio lease's drain allowance. */
export function apiShutdownBudgetMs(config: {
  aiSignalSchedulerEnabled?: boolean;
  aiSignalSchedulerShutdownGraceMs?: number;
  signalGenerationShutdownGraceMs: number;
  signalGenerationDbStatementTimeoutMs: number;
  signalGenerationDbLockTimeoutMs: number;
}): number {
  const budget = Math.max(config.signalGenerationShutdownGraceMs, config.aiSignalSchedulerEnabled ? (config.aiSignalSchedulerShutdownGraceMs ?? 0) : 0) +
    2 * (config.signalGenerationDbStatementTimeoutMs + config.signalGenerationDbLockTimeoutMs + 1000) + 5000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 2_147_483_647) {
    throw new Error("Invalid application shutdown budget.");
  }
  return budget;
}
