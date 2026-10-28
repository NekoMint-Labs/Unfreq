import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const baseProductionEnv = {
  AUTH_LOGIN_CODE_RESPONSE: "disabled",
  NODE_ENV: "production",
  PROVIDER_CONFIG_SECRET: "provider-config-secret-with-32-chars",
  SESSION_SECRET: "session-secret-with-at-least-32-chars",
  WEB_ORIGIN: "https://unfreq.example",
};

async function importEnv(overrides: NodeJS.ProcessEnv = {}) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    ...baseProductionEnv,
    ...overrides,
  };

  return import("./env.js");
}

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("API environment validation", () => {
  it("accepts non-placeholder production deployment values", async () => {
    await expect(importEnv()).resolves.toMatchObject({
      env: {
        isProduction: true,
        providerConfigSecret: baseProductionEnv.PROVIDER_CONFIG_SECRET,
        sessionSecret: baseProductionEnv.SESSION_SECRET,
        webOrigin: baseProductionEnv.WEB_ORIGIN,
      },
    });
  });

  it("rejects placeholder production secrets", async () => {
    await expect(
      importEnv({
        SESSION_SECRET: "replace-this-with-at-least-32-random-characters",
      }),
    ).rejects.toThrow("SESSION_SECRET must be a non-placeholder production secret");

    await expect(
      importEnv({
        PROVIDER_CONFIG_SECRET: "replace-this-with-at-least-32-random-characters",
      }),
    ).rejects.toThrow(
      "PROVIDER_CONFIG_SECRET must be a non-placeholder production secret",
    );
  });

  it("rejects placeholder or non-https production origins", async () => {
    await expect(
      importEnv({
        WEB_ORIGIN: "https://your-domain.example",
      }),
    ).rejects.toThrow("WEB_ORIGIN must be a real https:// production URL");

    await expect(
      importEnv({
        WEB_ORIGIN: "http://unfreq.example",
      }),
    ).rejects.toThrow("WEB_ORIGIN must be a real https:// production URL");
  });
});
