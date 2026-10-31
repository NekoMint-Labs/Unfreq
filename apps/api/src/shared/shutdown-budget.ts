/** Shared by the process watchdog and the audio lease's drain allowance. */
export function apiShutdownBudgetMs(config: {
  signalGenerationShutdownGraceMs: number;
  signalGenerationDbStatementTimeoutMs: number;
  signalGenerationDbLockTimeoutMs: number;
  aiSignalSchedulerEnabled?: boolean;
  aiSignalSchedulerShutdownGraceMs?: number;
}): number {
  // Consumers stop concurrently. The watchdog must allow the longest active
  // consumer's grace, including a scheduler configured beyond the default.
  const schedulerGrace = config.aiSignalSchedulerEnabled === false ? 0 : (config.aiSignalSchedulerShutdownGraceMs ?? 0);
  const budget = Math.max(config.signalGenerationShutdownGraceMs, schedulerGrace) +
    2 * (config.signalGenerationDbStatementTimeoutMs + config.signalGenerationDbLockTimeoutMs + 1000) + 5000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 2_147_483_647) {
    throw new Error("Invalid application shutdown budget.");
  }
  return budget;
}
