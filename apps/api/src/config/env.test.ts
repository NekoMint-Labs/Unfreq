import { afterEach, describe, expect, it, vi } from "vitest";

const policyRuleNames = [
  "registerIp", "registerSite", "passwordRequestIp", "passwordRequestSite",
  "passwordFailureIp", "passwordFailureIdentityIp", "emailRequestIp", "emailRequestSite", "emailVerifyIp", "emailVerifySite",
  "generationRequestUser", "generationDailyUser", "generationDailySite", "audioReadIp",
  "audioRequestIp", "audioNewIp", "audioNewDailySite", "diagnosticIp", "diagnosticSite",
  "chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite",
  "reportRequestUser", "reportRequestIp", "reportReadUser",
] as const;
const completePolicy = {
  namespace: "unfreq-env-unit",
  budgets: Object.fromEntries(policyRuleNames.map((name) => [name, { limit: 25, windowMs: 60_000 }])),
  pendingPerUser: 2,
  ttsConcurrency: 1,
  ttsTaskTimeoutMs: 1000,
};

const baseProductionEnv = {
  DOTENV_CONFIG_PATH: ".unfreq-unit-tests-no-env",
  AUTH_LOGIN_CODE_RESPONSE: undefined,
  AUTH_LOGIN_DELIVERY_MODE: undefined,
  ABUSE_PROTECTION_ENABLED: undefined,
  ABUSE_LIMITS_JSON: JSON.stringify(completePolicy),
  ABUSE_HMAC_SECRET: undefined,
  TRUSTED_PROXY_CIDRS: "",
  NODE_ENV: "production",
  PROVIDER_CONFIG_SECRET: "provider-config-secret-with-32-chars",
  SESSION_SECRET: "session-secret-with-at-least-32-chars",
  WEB_ORIGIN: "https://unfreq.example",
};

async function importEnv(overrides: NodeJS.ProcessEnv = {}) {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...baseProductionEnv, ...overrides })) vi.stubEnv(key, value);

  return import("./env.js");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("API environment validation", () => {
  it("accepts non-placeholder production deployment values", async () => {
    const imported = await importEnv();
    expect(imported).toMatchObject({
      env: {
        isProduction: true,
        authLoginDeliveryMode: "disabled",
        authLoginCodeResponseEnabled: false,
        abusePolicy: { enabled: true, configured: true, namespace: "unfreq-env-unit" },
        providerConfigSecret: baseProductionEnv.PROVIDER_CONFIG_SECRET,
        sessionSecret: baseProductionEnv.SESSION_SECRET,
        abuseHmacSecret: baseProductionEnv.SESSION_SECRET,
        webOrigin: baseProductionEnv.WEB_ORIGIN,
      },
    });
    expect(Object.keys(imported.env.abusePolicy.budgets).sort()).toEqual([...policyRuleNames].sort());
    expect(Object.keys(imported.env.abusePolicy.budgets)).toHaveLength(26);
  });

  it("rejects placeholder production secrets", async () => {
    await expect(
      importEnv({
        SESSION_SECRET: "replace-this-with-at-least-32-random-characters",
      }),
    ).rejects.toThrow(/SESSION_SECRET.*non-placeholder/u);

    await expect(
      importEnv({
        PROVIDER_CONFIG_SECRET: "replace-this-with-at-least-32-random-characters",
      }),
    ).rejects.toThrow(/PROVIDER_CONFIG_SECRET.*non-placeholder/u);
  });

  it("rejects placeholder or non-https production origins", async () => {
    await expect(
      importEnv({
        WEB_ORIGIN: "https://your-domain.example",
      }),
    ).rejects.toThrow(/WEB_ORIGIN.*https/u);

    await expect(
      importEnv({
        WEB_ORIGIN: "http://unfreq.example",
      }),
    ).rejects.toThrow(/WEB_ORIGIN.*https/u);
  });

  it.each([
    { name: "local-log delivery", overrides: { AUTH_LOGIN_DELIVERY_MODE: "local-log" } },
    { name: "code response", overrides: { AUTH_LOGIN_CODE_RESPONSE: "enabled" } },
  ])("rejects explicit production $name", async ({ overrides }) => {
    await expect(importEnv(overrides)).rejects.toThrow("production login challenges cannot use local-log or code responses");
  });

  it.each([
    { name: "disabled protection", overrides: { ABUSE_PROTECTION_ENABLED: "false" } },
    { name: "missing policy", overrides: { ABUSE_LIMITS_JSON: undefined } },
    { name: "blank policy", overrides: { ABUSE_LIMITS_JSON: " \t" } },
    { name: "partial rules", overrides: { ABUSE_LIMITS_JSON: JSON.stringify({ ...completePolicy, budgets: { registerIp: { limit: 25, windowMs: 60_000 } } }) } },
  ])("rejects production $name without contacting a database", async ({ overrides }) => {
    await expect(importEnv(overrides)).rejects.toMatchObject({ name: "AbusePolicyConfigurationError" });
  });

  it("keeps invalid policy contents out of the startup error", async () => {
    const marker = "synthetic-private-policy-value";
    const error = await importEnv({ ABUSE_LIMITS_JSON: `{"${marker}":` }).then(() => undefined, (caught: unknown) => caught);
    expect(error).toMatchObject({ name: "AbusePolicyConfigurationError" });
    expect(String(error)).not.toContain(marker);
    expect(error).not.toHaveProperty("cause");
  });

  it("uses the validated production session secret when the HMAC template value is empty", async () => {
    const { env } = await importEnv({ ABUSE_HMAC_SECRET: "" });
    expect(env.abuseHmacSecret).toBe(baseProductionEnv.SESSION_SECRET);
    expect(env.abusePolicy).toMatchObject({ enabled: true, configured: true });
  });

  it("uses the disabled synthetic test policy and preserves test-only local login delivery", async () => {
    const { env } = await importEnv({ NODE_ENV: "test", ABUSE_LIMITS_JSON: undefined });
    expect(env).toMatchObject({
      isTest: true, isProduction: false,
      authLoginDeliveryMode: "local-log", authLoginCodeResponseEnabled: true,
      abusePolicy: { enabled: false, configured: true, namespace: "unfreq-synthetic-test" },
    });
    for (const name of ["chatCallsSite", "embeddingCallsSite", "rerankerCallsSite", "ttsCharactersSite"] as const) {
      expect(env.abusePolicy.budgets[name].limit).toBe(0);
    }
  });

  it("does not mark the built-in development profile as an explicit remote-provider policy", async () => {
    const { env } = await importEnv({ NODE_ENV: "development", ABUSE_LIMITS_JSON: undefined });
    expect(env.abusePolicy).toMatchObject({ enabled: true, configured: false, namespace: "unfreq-synthetic-development" });
  });
});
