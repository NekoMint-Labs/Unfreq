import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: false, generate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../config/env.js", () => ({ env: { get aiSignalSchedulerEnabled() { return state.enabled; } } }));
vi.mock("./service.js", () => ({ generateAiSignals: state.generate }));

import { startAiSignalScheduler } from "./scheduler.js";

const logger = { warn: vi.fn() } as unknown as FastifyBaseLogger;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  state.enabled = false;
});

describe("scheduled AI generation opt-in", () => {
  it("creates no timer and dispatches nothing while disabled, including across 03:00", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T02:59:00"));
    const stop = startAiSignalScheduler(logger);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    expect(state.generate).not.toHaveBeenCalled();
    stop();
  });

  it("runs the explicitly enabled timer at 03:00 and cancels future runs on stop", async () => {
    state.enabled = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T02:59:00"));
    const stop = startAiSignalScheduler(logger);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.generate).toHaveBeenCalledExactlyOnceWith({ logger });
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
});
