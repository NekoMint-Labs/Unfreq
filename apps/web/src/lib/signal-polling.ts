type PollingOptions<T> = {
  read: (signal: AbortSignal) => Promise<T>;
  onValue: (value: T) => boolean;
  onError: (stopped: boolean) => void;
  intervalMs?: number;
  timeoutMs?: number;
  maxFailures?: number;
};

/** Schedule only after settlement; stopping also cancels the current fetch. */
export function startSignalPolling<T>({ read, onValue, onError, intervalMs = 1300,
  timeoutMs = 8000, maxFailures = 4 }: PollingOptions<T>) {
  let stopped = false;
  let failures = 0;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let current: AbortController | undefined;
  const poll = async () => {
    if (stopped) return;
    const request = new AbortController();
    current = request;
    const timeout = setTimeout(() => request.abort(), timeoutMs);
    let delay = intervalMs;
    try {
      const value = await read(request.signal);
      if (stopped) return;
      if (request.signal.aborted) throw new Error("Polling request timed out");
      failures = 0;
      if (!onValue(value)) { stopped = true; return; }
    } catch {
      if (stopped) return;
      failures += 1;
      stopped = failures >= maxFailures;
      onError(stopped);
      delay = Math.min(intervalMs * 2 ** failures, 8000);
    } finally {
      clearTimeout(timeout);
      current = undefined;
    }
    if (!stopped) scheduled = setTimeout(() => { void poll(); }, delay);
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(scheduled);
    current?.abort();
  };
}
