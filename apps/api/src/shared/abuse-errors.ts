import type { AbuseRuleName } from "../config/abuse.js";
import { AppError } from "./errors.js";

export type AbuseSafeRule = AbuseRuleName | "storage" | "configuration" | "concurrency";

/** This control error must cross Provider/local fallback catch boundaries intact. */
export class AbuseControlStopped extends AppError {
  readonly rule: AbuseSafeRule;
  readonly retryAfterSeconds?: number;
  readonly reason: "limited" | "unavailable" | "expired";

  constructor(reason: "limited" | "unavailable" | "expired", rule: AbuseSafeRule, retryAfterMs?: number) {
    const retryAfterSeconds = reason === "limited" && retryAfterMs !== undefined
      ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : undefined;
    super(reason === "limited" ? "RATE_LIMITED" : "AI_UNAVAILABLE",
      reason === "limited" ? "请求过于频繁，请稍后再试。" : "请求暂时无法处理，请稍后再试。",
      { abuseRule: rule, reason, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });
    this.name = "AbuseControlStopped";
    this.rule = rule;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function throwIfAbuseStopped(error: unknown): void {
  if (error instanceof AbuseControlStopped) throw error;
}
