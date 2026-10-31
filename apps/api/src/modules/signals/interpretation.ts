import type { SignalInterpretation } from "@unfreq/contracts/signals";

export function unknownSignalInterpretation(source: "rules" | "unknown" = "unknown"): SignalInterpretation {
  return { version: 1, state: "unknown", source };
}

/** Reads only server-persisted bookkeeping. Missing and malformed legacy data fail closed. */
export function resolveSignalInterpretation(value: unknown): SignalInterpretation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return unknownSignalInterpretation();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["version", "state", "source"].includes(key)) || item.version !== 1) return unknownSignalInterpretation();
  if (item.state === "unverified" && item.source === "provider") return { version: 1, state: "unverified", source: "provider" };
  if (item.state === "unknown" && (item.source === "rules" || item.source === "unknown")) return unknownSignalInterpretation(item.source);
  return unknownSignalInterpretation();
}

/** Attach after parsing model output; a model cannot certify its own source or accuracy. */
export function interpretationFromExecution(execution: { source: unknown }): SignalInterpretation {
  return execution.source === "provider"
    ? { version: 1, state: "unverified", source: "provider" }
    : unknownSignalInterpretation(execution.source === "rules" ? "rules" : "unknown");
}

/** Unverified provider output may be an algorithm input, never a verified personal claim. */
export function canReferenceSignalInterpretation(value: unknown): boolean {
  return resolveSignalInterpretation(value).state === "unverified";
}

/** No validated display state exists yet. Source attribution alone cannot enable display. */
export function canDisplaySignalInterpretation(_value: unknown): false {
  return false;
}

export const unknownInterpretationText = "暂不作心理解读";
