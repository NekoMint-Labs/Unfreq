import { createHash } from "node:crypto";
import type { AiExecutionMetadata, AiProviderAttempt } from "@unfreq/contracts/admin";

export type ProviderResult<T> = { output: T; execution: AiExecutionMetadata };
export type { AiExecutionMetadata, AiProviderAttempt };

export const chatInputTemplateVersion = "chat-task-input-v1";
export const ruleVersion = "local-rules-v1";

export function promptVersion(prompt: string, options: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([chatInputTemplateVersion, prompt, options])).digest("hex")}`;
}

// Only bounded, documented accounting fields cross the transport boundary.
// Never copy arbitrary provider response fields, messages, URLs or headers.
export function safeProviderAccounting(payload: unknown): Pick<AiProviderAttempt, "responseModel" | "usage"> {
  if (typeof payload !== "object" || payload === null) return {};
  const record = payload as Record<string, unknown>;
  const responseModel = typeof record.model === "string" && /^[\w./:@+-]{1,128}$/u.test(record.model)
    ? record.model : undefined;
  const rawUsage = typeof record.usage === "object" && record.usage !== null
    ? record.usage as Record<string, unknown> : {};
  const usage: Record<string, number> = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"] as const) {
    const value = rawUsage[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) usage[key] = value;
  }
  return { ...(responseModel === undefined ? {} : { responseModel }),
    ...(Object.keys(usage).length === 0 ? {} : { usage }) };
}

export function ruleExecution(taskType: string, previous?: AiExecutionMetadata): AiExecutionMetadata {
  return { schemaVersion: 1, taskType: previous?.taskType ?? taskType, source: "rules", provider: "local-rules", model: ruleVersion,
    promptVersion: previous?.promptVersion ?? ruleVersion,
    inputTemplateVersion: previous?.inputTemplateVersion ?? chatInputTemplateVersion,
    durationMs: previous?.durationMs ?? 0, attempts: previous?.attempts ?? [],
    fallbackReason: previous?.source === "provider" ? "invalid_business_output" : "provider_unavailable",
    cost: "unknown" };
}
