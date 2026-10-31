import { describe, expect, it } from "vitest";
import { apiShutdownBudgetMs } from "./shutdown-budget.js";

const base = { signalGenerationShutdownGraceMs: 10_000,
  signalGenerationDbStatementTimeoutMs: 5_000, signalGenerationDbLockTimeoutMs: 1_000 };

describe("application shutdown watchdog allowance", () => {
  it("keeps the existing allowance when scheduler settings are absent or disabled", () => {
    expect(apiShutdownBudgetMs(base)).toBe(29_000);
    expect(apiShutdownBudgetMs({ ...base, aiSignalSchedulerEnabled: false, aiSignalSchedulerShutdownGraceMs: 120_000 })).toBe(29_000);
  });
  it("allows an enabled scheduler its full longer grace before forcing process recovery", () => {
    expect(apiShutdownBudgetMs({ ...base, aiSignalSchedulerEnabled: true, aiSignalSchedulerShutdownGraceMs: 120_000 })).toBe(139_000);
    expect(apiShutdownBudgetMs({ ...base, aiSignalSchedulerEnabled: true, aiSignalSchedulerShutdownGraceMs: 1_000 })).toBe(29_000);
  });
  it("refuses an invalid timer allowance rather than silently overflowing the watchdog", () => {
    expect(() => apiShutdownBudgetMs({ ...base, aiSignalSchedulerShutdownGraceMs: Infinity })).toThrow();
    expect(() => apiShutdownBudgetMs({ ...base, aiSignalSchedulerShutdownGraceMs: 2_147_483_647 })).toThrow();
  });
});
