export type AiSignalSchedulerConfig = {
  enabled: boolean;
  timeZone: string;
  scheduledTime: string;
  count: number;
  dailySignalBudget: number;
  dailyDispatchBudget: number;
  pollIntervalMs: number;
  batchTimeoutMs: number;
  shutdownGraceMs: number;
  dbStatementTimeoutMs: number;
  dbLockTimeoutMs: number;
};

export type SchedulerBatchClaim = {
  id: string;
  businessDate: string;
  ownerToken: string;
  requestedCount: number;
};

export type SchedulerBatchProgress = {
  accepted: number;
  rejected: number;
  attempts: number;
  signalIds: string[];
};

export type SchedulerBatchFinish = SchedulerBatchProgress & {
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  failureCode?: "BUDGET_EXHAUSTED" | "DEADLINE" | "SHUTDOWN" | "OWNERSHIP_LOST" | "EXECUTION_FAILED";
};

export type AiSignalSchedulerRepository = {
  claim(params: { businessDate: string; ownerToken: string; config: AiSignalSchedulerConfig }): Promise<SchedulerBatchClaim | undefined>;
  isActive(claim: SchedulerBatchClaim): Promise<boolean>;
  reserveDispatch(claim: SchedulerBatchClaim): Promise<"reserved" | "budget" | "obsolete">;
  recordProgress(claim: SchedulerBatchClaim, progress: SchedulerBatchProgress): Promise<boolean>;
  finish(claim: SchedulerBatchClaim, result: SchedulerBatchFinish): Promise<boolean>;
  close(force?: boolean): Promise<void>;
};

export type SchedulerRunResult = {
  status: "disabled" | "not-due" | "already-claimed" | "completed" | "failed" | "cancelled" | "stopped";
  businessDate?: string;
};
