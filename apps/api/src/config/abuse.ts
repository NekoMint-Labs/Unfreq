import { z } from "zod";

export const ruleNames = [
  "registerIp", "registerSite", "passwordRequestIp", "passwordRequestSite",
  "passwordFailureIp", "passwordFailureIdentityIp", "emailRequestIp", "emailRequestSite", "emailVerifyIp", "emailVerifySite",
  "generationRequestUser", "generationDailyUser", "generationDailySite", "audioReadIp",
  "audioRequestIp", "audioNewIp", "audioNewDailySite", "diagnosticIp", "diagnosticSite",
  "chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite",
] as const;

export type AbuseRuleName = typeof ruleNames[number];
export type AbuseBudget = Readonly<{ limit: number; windowMs: number }>;
export type AbusePolicy = Readonly<{
  enabled: boolean;
  configured: boolean;
  namespace: string;
  budgets: Readonly<Record<AbuseRuleName, AbuseBudget>>;
  pendingPerUser: number;
  ttsConcurrency: number;
  ttsTaskTimeoutMs: number;
}>;

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const budgetSchema = z.object({
  // Zero means deny this budget, never unlimited.
  limit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  windowMs: positiveInteger,
}).strict();
const budgetShape = Object.fromEntries(ruleNames.map((name) => [name, budgetSchema])) as
  Record<AbuseRuleName, typeof budgetSchema>;
const explicitPolicySchema = z.object({
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  budgets: z.object(budgetShape).strict(),
  pendingPerUser: positiveInteger,
  ttsConcurrency: positiveInteger,
  // This field feeds a Node timer; avoid overflow silently becoming 1 ms.
  ttsTaskTimeoutMs: positiveInteger.max(2_147_483_647),
}).strict();

export class AbusePolicyConfigurationError extends Error {
  constructor() {
    super("Invalid abuse policy configuration.");
    this.name = "AbusePolicyConfigurationError";
  }
}

function syntheticProfile(mode: "development" | "test") {
  const daily = new Set<AbuseRuleName>(["generationDailyUser", "generationDailySite", "audioNewDailySite"]);
  const paid = new Set<AbuseRuleName>(["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"]);
  const budgets = Object.fromEntries(ruleNames.map((name) => [name, {
    limit: paid.has(name) ? 0 : 100,
    windowMs: daily.has(name) ? 86_400_000 : 60_000,
  }])) as Record<AbuseRuleName, AbuseBudget>;
  return { namespace: `unfreq-synthetic-${mode}`, budgets, pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000 };
}

/** Pure parser: it never reads process.env, connects to storage or supplies production thresholds. */
export function parseAbusePolicy(options: {
  mode: "development" | "test" | "production";
  enabled?: boolean;
  json?: string;
}): AbusePolicy {
  try {
    if (!["development", "test", "production"].includes(options.mode) ||
        (options.enabled !== undefined && typeof options.enabled !== "boolean") ||
        (options.json !== undefined && typeof options.json !== "string")) throw new AbusePolicyConfigurationError();
    const enabled = options.enabled ?? options.mode !== "test";
    const supplied = options.json !== undefined && options.json.trim().length > 0;
    if (options.mode === "production" && (!enabled || !supplied)) throw new AbusePolicyConfigurationError();
    const values = supplied ? explicitPolicySchema.parse(JSON.parse(options.json!)) : syntheticProfile(options.mode as "development" | "test");
    // The built-in test-only profile is an explicit synthetic configuration,
    // disabled by default. It is never a production/development remote budget.
    return { ...values, enabled, configured: supplied || options.mode === "test" };
  } catch {
    // JSON.parse/Zod messages can contain arbitrary configuration text. Do not
    // put that text (or a cause containing it) into startup logs.
    throw new AbusePolicyConfigurationError();
  }
}
