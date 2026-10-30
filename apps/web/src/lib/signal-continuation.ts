export const continuationStorageKey = "unfreq:pending-continuation:v1";
export type SignalContinuation = { seedText: string; parentSignalId?: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function normalizeContinuation(seedText: unknown, parentSignalId: unknown): SignalContinuation {
  return { seedText: typeof seedText === "string" && seedText.length <= 200 ? seedText : "",
    ...(typeof parentSignalId === "string" && uuid.test(parentSignalId) ? { parentSignalId: parentSignalId.toLowerCase() } : {}) };
}
export function parseContinuation(value: string | null): SignalContinuation | undefined {
  try {
    const data = JSON.parse(value ?? "null");
    if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.seedText !== "string" || data.seedText.length > 200) return;
    const normalized = normalizeContinuation(data.seedText, data.parentSignalId);
    if (data.parentSignalId !== undefined && normalized.parentSignalId === undefined) return;
    return normalized;
  } catch { return; }
}
export function readContinuationSnapshot(): string | null {
  try { return window.sessionStorage.getItem(continuationStorageKey); } catch { return null; }
}
export function saveContinuation(value: SignalContinuation) {
  const serialized = JSON.stringify(value);
  if (parseContinuation(serialized) === undefined) throw new Error("Invalid continuation");
  window.sessionStorage.setItem(continuationStorageKey, serialized);
}
export function clearContinuation() {
  try { window.sessionStorage.removeItem(continuationStorageKey); } catch { /* no persisted draft */ }
}
