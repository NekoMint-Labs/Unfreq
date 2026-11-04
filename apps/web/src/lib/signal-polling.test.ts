import { afterEach, describe, expect, it, vi } from "vitest";
import { startSignalPolling } from "./signal-polling";

afterEach(() => vi.useRealTimers());
describe("generation polling lifecycle", () => {
  it("does not overlap an arbitrarily slow request", async () => {
    vi.useFakeTimers();
    let resolve!: (value: number) => void;
    const read = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const stop = startSignalPolling({ read, onValue: () => true, onError: vi.fn(), timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    resolve(1); await vi.advanceTimersByTimeAsync(1299);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
  it("resets failure backoff after recovery and stops on a terminal value", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce("pending").mockResolvedValueOnce("complete");
    const onError = vi.fn(); const onValue = vi.fn((value) => value !== "complete");
    startSignalPolling({ read, onError, onValue });
    await vi.advanceTimersByTimeAsync(2600);
    expect(onError).toHaveBeenCalledWith(false);
    expect(onValue).toHaveBeenCalledWith("pending");
    await vi.advanceTimersByTimeAsync(1300);
    expect(onValue).toHaveBeenLastCalledWith("complete");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("bounds consecutive failures and does not keep retrying forever", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValue(new Error("offline")); const onError = vi.fn();
    startSignalPolling({ read, onError, onValue: () => true });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenLastCalledWith(true);
  });
  it("aborts on cleanup and ignores late values", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void; let signal!: AbortSignal;
    const onValue = vi.fn(); const onError = vi.fn();
    const stop = startSignalPolling({ read: (input) => { signal = input; return new Promise<string>((done) => { resolve = done; }); }, onValue, onError });
    stop(); expect(signal.aborted).toBe(true); resolve("late");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onValue).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });
  it("times out the current request before scheduling another", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const read = vi.fn((signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const stop = startSignalPolling({ read, onValue: () => true, onError });
    await vi.advanceTimersByTimeAsync(8000);
    expect(read).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(2600);
    expect(read).toHaveBeenCalledTimes(2); stop();
  });
});
