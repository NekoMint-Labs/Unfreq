import { createHmac, scrypt, scryptSync } from "node:crypto";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUserRecord } from "./types.js";

const state = vi.hoisted(() => ({
  env: { authLoginDeliveryMode: "local-log", authLoginCodeResponseEnabled: true, isProduction: false,
    authLoginChallengeTtlSeconds: 600, authLoginMaxVerifyAttempts: 5, authLoginRequestCooldownSeconds: 60,
    sessionSecret: "synthetic-auth-service-secret-only" },
  user: undefined as AuthUserRecord | undefined,
}));
vi.mock("../../config/env.js", () => ({ env: state.env }));
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});
vi.mock("./repository.js", () => ({
  createPasswordFrequencyUser: vi.fn(), createUser: vi.fn(),
  findUserByEmail: vi.fn(() => Promise.resolve(state.user)),
  findUserByFreqCode: vi.fn(() => Promise.resolve(state.user)),
  findUserById: vi.fn(() => Promise.resolve(state.user)),
}));
import { loginWithFrequencyCredentials, requestLoginChallenge, verifyLoginChallenge } from "./service.js";

const password = "synthetic-control-password";
const passwordHash = `scrypt:synthetic-salt:${scryptSync(password, "synthetic-salt", 64).toString("base64url")}`;
const user = (hash: string | null = passwordHash): AuthUserRecord => ({
  id: "00000000-0000-4000-8000-000000000101", freqCode: "FM 11.11", email: "synthetic@example.com",
  frequencyName: null, isGuest: false, passwordHash: hash, role: "USER", status: "ACTIVE",
  createdAt: new Date(0), updatedAt: new Date(0),
});
function storage(result: unknown = [1, 0, 0]) {
  const codeHash = createHmac("sha256", state.env.sessionSecret).update("login-code:123456").digest("base64url");
  const get = vi.fn().mockResolvedValue(JSON.stringify({ attemptCount: 0, codeHash, email: "synthetic@example.com",
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() }));
  const evalCommand = vi.fn().mockResolvedValue(result);
  const client = { eval: evalCommand, get, set: vi.fn().mockResolvedValue("OK"), del: vi.fn().mockResolvedValue(1), ttl: vi.fn().mockResolvedValue(60) };
  return { client: client as unknown as Redis, evalCommand, get, set: client.set, del: client.del };
}
beforeEach(() => {
  state.env.authLoginDeliveryMode = "local-log";
  state.env.authLoginCodeResponseEnabled = true;
  state.env.isProduction = false;
  state.user = user();
  vi.mocked(scrypt).mockClear();
});

describe("auth service security boundaries", () => {
  it("keeps the legitimate development email and password workflows", async () => {
    const redis = storage();
    expect(await requestLoginChallenge(redis.client, " Synthetic@Example.COM ")).toMatchObject({ delivery: { mode: "local-log", code: expect.stringMatching(/^\d{6}$/u) } });
    expect(await loginWithFrequencyCredentials({ frequencyCode: " fm-11.11 ", password })).toMatchObject({ frequency: { id: user().id } });
    expect(await verifyLoginChallenge(redis.client, { email: "synthetic@example.com", code: "123456" })).toMatchObject({ frequency: { id: user().id } });
  });
  it.each(["disabled", "production"])("rejects issue and verification before storage in %s mode", async (mode) => {
    state.env.authLoginDeliveryMode = mode === "disabled" ? "disabled" : "local-log";
    state.env.isProduction = mode === "production";
    const redis = storage();
    await expect(requestLoginChallenge(redis.client, "synthetic@example.com")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(verifyLoginChallenge(redis.client, { email: "synthetic@example.com", code: "123456" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.evalCommand).not.toHaveBeenCalled();
    expect(await loginWithFrequencyCredentials({ frequencyCode: "FM 11.11", password })).toMatchObject({ frequency: { id: user().id } });
  });
  it.each(["unknown", "passwordless"])("runs a dummy scrypt for %s identities and preserves the same 401", async (mode) => {
    state.user = mode === "unknown" ? undefined : user(null);
    await expect(loginWithFrequencyCredentials({ frequencyCode: "FM 11.11", password })).rejects.toMatchObject({
      code: "UNAUTHORIZED", message: "Invalid frequency or password.",
    });
    expect(scrypt).toHaveBeenCalledTimes(1);
  });
  it("uses one atomic verification command instead of client-side read/delete", async () => {
    const redis = storage();
    await verifyLoginChallenge(redis.client, { email: " Synthetic@Example.COM ", code: "123456" });
    expect(redis.evalCommand).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    const args = redis.evalCommand.mock.calls[0];
    expect(args).toContain("synthetic@example.com");
    expect(args).not.toContain("123456");
  });
  it("maps a rejected atomic result without a second storage mutation", async () => {
    const redis = storage([0, 3, 0]);
    await expect(verifyLoginChallenge(redis.client, { email: "synthetic@example.com", code: "123456" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", details: { remainingAttempts: 3 } });
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
  it.each([
    { reply: [-1, 0, 0], code: "UNAUTHORIZED", details: { reason: "MISSING" } },
    { reply: [-2, 0, 0], code: "UNAUTHORIZED", details: { reason: "INVALID_CHALLENGE" } },
    { reply: [-3, 0, 12], code: "RATE_LIMITED", details: { limitType: "AUTH_LOGIN_VERIFY", retryAfterSeconds: 12 } },
  ])("maps atomic result $reply without minting a session", async ({ reply, code, details }) => {
    const redis = storage(reply);
    await expect(verifyLoginChallenge(redis.client, { email: "synthetic@example.com", code: "123456" }))
      .rejects.toMatchObject({ code, details });
    expect(redis.evalCommand).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
  it("replaces storage errors and invalid replies with safe dependency failures", async () => {
    const redis = storage();
    const marker = "SYNTHETIC_REDIS_PRIVATE_COMMAND_MARKER";
    redis.evalCommand.mockRejectedValueOnce(new Error(marker));
    for (const invoke of [
      () => verifyLoginChallenge(redis.client, { email: "synthetic@example.com", code: "123456" }),
      () => { redis.evalCommand.mockResolvedValueOnce("unexpected"); return verifyLoginChallenge(redis.client, { email: "synthetic@example.com", code: "123456" }); },
      () => { redis.set.mockRejectedValueOnce(new Error(marker)); return requestLoginChallenge(redis.client, "synthetic@example.com"); },
    ]) {
      try { await invoke(); expect.fail("Storage uncertainty must not authenticate."); }
      catch (error) {
        expect(error).toMatchObject({ code: "AI_UNAVAILABLE", statusCode: 503, message: "Authentication temporarily unavailable." });
        expect(String(error)).not.toContain(marker);
      }
    }
  });
});
