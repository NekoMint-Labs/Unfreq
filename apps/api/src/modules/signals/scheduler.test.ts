import { afterEach, describe, expect, it, vi } from "vitest";
import { beforeGenerationDispatch, getGenerationExecutionContext } from "../../shared/generation-execution.js";
import { createAiSignalScheduler } from "./scheduler.js";
import { schedulerBusinessTime } from "./scheduler-time.js";
import type { AiSignalSchedulerConfig, AiSignalSchedulerRepository, SchedulerBatchClaim, SchedulerBatchFinish } from "./scheduler-types.js";
import type { AiSignalGenerationSummary } from "./types.js";

vi.mock("./scheduler-repository.js", () => ({ configureAiSignalSchedulerRepository: vi.fn() }));
vi.mock("./service-generated.js", () => ({ generateAiSignals: vi.fn() }));

const config: AiSignalSchedulerConfig = { enabled: true, timeZone: "Asia/Shanghai", scheduledTime: "03:00", count: 1,
  dailySignalBudget: 1, dailyDispatchBudget: 2, pollIntervalMs: 100, batchTimeoutMs: 1000,
  shutdownGraceMs: 100, dbStatementTimeoutMs: 200, dbLockTimeoutMs: 100 };
const due = new Date("2026-10-30T19:00:00Z");
const summary: AiSignalGenerationSummary = { accepted: 0, rejected: 1, attempts: 3, results: [] };
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const rows = new Map<string, SchedulerBatchClaim & { status: string; dispatchCount: number; result?: SchedulerBatchFinish }>();
  const repository: AiSignalSchedulerRepository = {
    claim: vi.fn(async ({ businessDate, ownerToken }) => {
      if (rows.has(businessDate)) return undefined;
      const row = { id: ownerToken, ownerToken, businessDate, requestedCount: 1, status: "RUNNING", dispatchCount: 0 };
      rows.set(businessDate, row); return row;
    }),
    isActive: vi.fn(async (claim) => rows.get(claim.businessDate)?.status === "RUNNING"),
    reserveDispatch: vi.fn(async (claim) => {
      const row = rows.get(claim.businessDate)!;
      if (row.status !== "RUNNING") return "obsolete";
      if (row.dispatchCount >= config.dailyDispatchBudget) return "budget";
      row.dispatchCount++; return "reserved";
    }),
    recordProgress: vi.fn(async () => true),
    finish: vi.fn(async (claim, result) => {
      const row = rows.get(claim.businessDate)!;
      if (row.status !== "RUNNING") return false;
      row.status = result.status; row.result = result; return true;
    }),
    close: vi.fn(async () => {}),
  };
  const execute = vi.fn(async () => { await beforeGenerationDispatch("chat", "signal-content"); return summary; });
  return { repository, execute, rows };
}
afterEach(() => vi.useRealTimers());

describe("durable daily AI signal scheduler orchestration", () => {
  it("is disabled by default configuration and does not touch a repository when disabled", async () => {
    const f = fixture();
    const scheduler = createAiSignalScheduler({ ...f, config: { ...config, enabled: false } });
    scheduler.start();
    expect(await scheduler.runDue(due)).toEqual({ status: "disabled" });
    expect(f.repository.claim).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    await scheduler.stop();
  });
  it("uses the business calendar at the 03:00 boundary and handles DST dates", () => {
    expect(schedulerBusinessTime(due, "Asia/Shanghai")).toEqual({ businessDate: "2026-10-31", time: "03:00" });
    expect(schedulerBusinessTime(new Date("2026-03-08T07:00:00Z"), "America/New_York")).toEqual({ businessDate: "2026-03-08", time: "03:00" });
    expect(schedulerBusinessTime(new Date("2026-11-01T08:00:00Z"), "America/New_York")).toEqual({ businessDate: "2026-11-01", time: "03:00" });
  });
  it("skips before the trigger, claims at/after it once and permits a new business day", async () => {
    const f = fixture();
    const scheduler = createAiSignalScheduler({ ...f, config });
    expect(await scheduler.runDue(new Date("2026-10-30T18:59:59Z"))).toMatchObject({ status: "not-due" });
    expect(f.repository.claim).not.toHaveBeenCalled();
    expect(await scheduler.runDue(due)).toMatchObject({ status: "completed", businessDate: "2026-10-31" });
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ count: 1, businessDate: "2026-10-31", syncEmbedding: true }));
    expect(await scheduler.runDue(new Date("2026-10-31T10:00:00Z"))).toMatchObject({ status: "already-claimed" });
    expect(await scheduler.runDue(new Date("2026-10-31T19:00:00Z"))).toMatchObject({ status: "completed", businessDate: "2026-11-01" });
    expect(f.execute).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
  it("rejects unknown time zones, invalid times and counts above the signal budget", () => {
    const f = fixture();
    for (const overrides of [{ timeZone: "Not/AZone" }, { scheduledTime: "24:00" }, { count: 2 }, { dailyDispatchBudget: 0 }]) {
      expect(() => createAiSignalScheduler({ ...f, config: { ...config, ...overrides } })).toThrow();
    }
  });
  it("requires a committed claim before dispatch and enforces the batch dispatch budget without rerun", async () => {
    const f = fixture();
    let dispatched = 0;
    const execute = vi.fn(async () => {
      for (let index = 0; index < 3; index++) { await beforeGenerationDispatch("chat", "synthetic"); dispatched++; }
      return summary;
    });
    const scheduler = createAiSignalScheduler({ config, repository: f.repository, execute });
    expect(await scheduler.runDue(due)).toMatchObject({ status: "failed" });
    expect(dispatched).toBe(2);
    expect(f.rows.get("2026-10-31")?.result).toMatchObject({ status: "FAILED", failureCode: "BUDGET_EXHAUSTED" });
    expect(await scheduler.runDue(due)).toMatchObject({ status: "already-claimed" });
    expect(execute).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });
  it("refuses a dispatch after the stored ownership/deadline predicate fails", async () => {
    const f = fixture();
    vi.mocked(f.repository.isActive).mockResolvedValue(false);
    const scheduler = createAiSignalScheduler({ ...f, config });
    expect(await scheduler.runDue(due)).toMatchObject({ status: "failed" });
    expect(f.repository.reserveDispatch).not.toHaveBeenCalled();
    expect(f.rows.get("2026-10-31")?.result?.failureCode).toBe("OWNERSHIP_LOST");
    await scheduler.stop();
  });
  it("waits for a pending claim on stop and never starts its generation afterward", async () => {
    const f = fixture();
    const originalClaim = vi.mocked(f.repository.claim).getMockImplementation()!;
    const gate = deferred();
    vi.mocked(f.repository.claim).mockImplementation(async (params) => { await gate.promise; return originalClaim(params); });
    const scheduler = createAiSignalScheduler({ ...f, config });
    const running = scheduler.runDue(due);
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    gate.resolve();
    await stopping;
    expect(await running).toMatchObject({ status: "cancelled" });
    expect(f.execute).not.toHaveBeenCalled();
    expect(await scheduler.runDue(due)).toEqual({ status: "stopped" });
  });
  it("aborts active execution and does not report drain before the underlying work settles", async () => {
    const f = fixture();
    const entered = deferred();
    const cleanup = deferred();
    const execute = vi.fn(async () => {
      const context = getGenerationExecutionContext()!;
      entered.resolve();
      await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
      await cleanup.promise;
      throw context.signal.reason;
    });
    const scheduler = createAiSignalScheduler({ config, repository: f.repository, execute });
    const running = scheduler.runDue(due);
    await entered.promise;
    let drained = false;
    const stopping = scheduler.stop().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    cleanup.resolve(); await stopping;
    expect(await running).toMatchObject({ status: "cancelled" });
    expect(f.rows.get("2026-10-31")?.status).toBe("CANCELLED");
  });
  it("keeps raw exceptions out of scheduler diagnostics and retains the failed day", async () => {
    const f = fixture();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const scheduler = createAiSignalScheduler({ config, repository: f.repository, logger,
      execute: vi.fn(async () => { throw new Error("PRIVATE_SEED_PASSWORD_TOKEN"); }) });
    expect(await scheduler.runDue(due)).toMatchObject({ status: "failed" });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("PRIVATE_SEED_PASSWORD_TOKEN");
    expect(await scheduler.runDue(due)).toMatchObject({ status: "already-claimed" });
    await scheduler.stop();
  });
  it("force-closes actual owned I/O after grace and waits for the released work", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const entered = deferred();
    const io = deferred();
    let underlyingSettled = false;
    const forceClose = vi.fn(async () => { io.resolve(); });
    const scheduler = createAiSignalScheduler({ config, repository: f.repository,
      forceCloseApplicationDatabase: forceClose, execute: vi.fn(async () => {
        entered.resolve();
        await io.promise;
        underlyingSettled = true;
        throw getGenerationExecutionContext()!.signal.reason;
      }) });
    const running = scheduler.runDue(due); await entered.promise;
    const stopping = scheduler.stop();
    await vi.advanceTimersByTimeAsync(config.shutdownGraceMs - 1);
    expect(forceClose).not.toHaveBeenCalled();
    expect(underlyingSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await stopping;
    expect(forceClose).toHaveBeenCalledOnce();
    expect(f.repository.close).toHaveBeenCalledWith(true);
    expect(underlyingSettled).toBe(true);
    expect(await running).toMatchObject({ status: "cancelled" });
  });
  it("rejects shutdown when forced closure still cannot drain the underlying operation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const entered = deferred();
    const io = deferred();
    const scheduler = createAiSignalScheduler({ config: { ...config, batchTimeoutMs: 10_000 }, repository: f.repository,
      forceCloseApplicationDatabase: vi.fn(async () => {}), execute: vi.fn(async () => {
        entered.resolve(); await io.promise; return summary;
      }) });
    const running = scheduler.runDue(due); await entered.promise;
    const rejected = expect(scheduler.stop()).rejects.toThrow("did not drain");
    await vi.advanceTimersByTimeAsync(config.shutdownGraceMs + config.dbStatementTimeoutMs + 1000);
    await rejected;
    expect(f.repository.close).toHaveBeenCalledWith(true);
    // Explicit fixture cleanup after the required failure; it is not a
    // successful production drain or an automatic retry of the batch.
    io.resolve(); await running;
  });
  it("enforces a batch deadline by aborting execution and preserving the day claim", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const entered = deferred();
    const scheduler = createAiSignalScheduler({ config, repository: f.repository, execute: vi.fn(async () => {
      const context = getGenerationExecutionContext()!;
      entered.resolve();
      await new Promise<void>((_, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true }));
      return summary;
    }) });
    const running = scheduler.runDue(due); await entered.promise;
    await vi.advanceTimersByTimeAsync(config.batchTimeoutMs);
    expect(await running).toMatchObject({ status: "failed" });
    expect(f.rows.get("2026-10-31")?.result?.failureCode).toBe("DEADLINE");
    expect(await scheduler.runDue(due)).toMatchObject({ status: "already-claimed" });
    await scheduler.stop();
  });
});
