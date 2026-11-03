import { describe, expect, it } from "vitest";
import { AbusePolicyConfigurationError, parseAbusePolicy, ruleNames } from "./abuse.js";

function explicitProfile() {
  return {
    namespace: "synthetic-policy-unit",
    budgets: Object.fromEntries(ruleNames.map((name) => [name, { limit: 5, windowMs: 1000 }])),
    pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000,
  };
}

describe("abuse policy configuration", () => {
  it("requires all 26 named rules, including report reads and submissions", () => {
    expect(ruleNames).toHaveLength(26);
    expect(ruleNames).toContain("reportRequestUser");
    expect(ruleNames).toContain("reportRequestIp");
    expect(ruleNames).toContain("reportReadUser");
    expect(ruleNames).toContain("emailRequestSite");
    expect(ruleNames).toContain("emailVerifySite");
    const policy = parseAbusePolicy({ mode: "production", json: JSON.stringify(explicitProfile()) });
    expect(policy.enabled).toBe(true);
    expect(policy.configured).toBe(true);
    expect(Object.keys(policy.budgets)).toHaveLength(26);
  });

  it("provides only a clearly synthetic, disabled test profile without JSON", () => {
    const policy = parseAbusePolicy({ mode: "test" });
    expect(policy).toMatchObject({ enabled: false, configured: true, namespace: "unfreq-synthetic-test" });
    expect(policy.budgets.generationDailyUser.windowMs).toBe(86_400_000);
    expect(policy.budgets.chatCallsSite.limit).toBe(0);
  });

  it("keeps unconfigured development distinct from explicit remote authorization", () => {
    expect(parseAbusePolicy({ mode: "development" })).toMatchObject({ enabled: true, configured: false });
    expect(parseAbusePolicy({ mode: "development", enabled: false })).toMatchObject({ enabled: false, configured: false });
  });

  it.each([
    { mode: "production" as const },
    { mode: "production" as const, json: " " },
    { mode: "production" as const, enabled: false, json: JSON.stringify(explicitProfile()) },
  ])("rejects a production bypass or absent production policy: %o", (options) => {
    expect(() => parseAbusePolicy(options)).toThrow(AbusePolicyConfigurationError);
  });

  it("preserves zero as an explicit deny budget rather than unlimited", () => {
    const profile = explicitProfile();
    profile.budgets.ttsCharactersSite.limit = 0;
    expect(parseAbusePolicy({ mode: "production", json: JSON.stringify(profile) }).budgets.ttsCharactersSite.limit).toBe(0);
  });

  it.each(["top", "rule", "budget", "missing"])("rejects unknown and missing configuration at depth %s", (kind) => {
    const profile = explicitProfile();
    if (kind === "top") Object.assign(profile, { ignoredLimit: 100 });
    if (kind === "rule") profile.budgets.unknownRule = { limit: 100, windowMs: 1000 };
    if (kind === "budget") Object.assign(profile.budgets.registerIp, { unlimited: true });
    if (kind === "missing") delete profile.budgets.emailVerifySite;
    expect(() => parseAbusePolicy({ mode: "production", json: JSON.stringify(profile) })).toThrow(AbusePolicyConfigurationError);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "5", null])("rejects invalid quota limit %s", (value) => {
    const profile = explicitProfile();
    Object.assign(profile.budgets.registerIp, { limit: value });
    expect(() => parseAbusePolicy({ mode: "test", json: JSON.stringify(profile) })).toThrow(AbusePolicyConfigurationError);
  });

  it.each([0, -1, 0.5, "1000"])("requires a finite positive integer window: %s", (value) => {
    const profile = explicitProfile();
    Object.assign(profile.budgets.registerIp, { windowMs: value });
    expect(() => parseAbusePolicy({ mode: "test", json: JSON.stringify(profile) })).toThrow(AbusePolicyConfigurationError);
  });

  it("rejects nonfinite JSON numbers and Node timer overflow", () => {
    const json = JSON.stringify(explicitProfile()).replace('"limit":5', '"limit":1e309');
    expect(() => parseAbusePolicy({ mode: "test", json })).toThrow(AbusePolicyConfigurationError);
    expect(() => parseAbusePolicy({ mode: "test", json: JSON.stringify({ ...explicitProfile(), ttsTaskTimeoutMs: 2_147_483_648 }) })).toThrow(AbusePolicyConfigurationError);
  });

  it("does not echo malformed or unknown sensitive configuration in errors", () => {
    const marker = "SYNTHETIC_POLICY_SECRET_MUST_NOT_BE_LOGGED";
    for (const json of [`{${marker}`, JSON.stringify({ ...explicitProfile(), [marker]: marker })]) {
      try {
        parseAbusePolicy({ mode: "production", json });
        expect.fail("invalid configuration was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(AbusePolicyConfigurationError);
        expect(String(error)).not.toContain(marker);
      }
    }
  });
});
