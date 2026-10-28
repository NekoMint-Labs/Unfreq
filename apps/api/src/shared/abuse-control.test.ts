import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAbusePolicy, ruleNames } from "../config/abuse.js";
import { AbuseControlStopped, throwIfAbuseStopped } from "./abuse-errors.js";
import { createAbuseGuard, getAbuseGuard, type AbuseRedisLike } from "./abuse-control.js";

vi.mock("../config/env.js", () => ({ env: {
  abusePolicy: undefined, abuseHmacSecret: "synthetic-unit-hmac-secret-32-characters",
  redisUrl: "redis://127.0.0.1:1", healthDependencyTimeoutMs: 100,
} }));

const secret = "synthetic-unit-hmac-secret-32-characters";
function policy(namespace = "synthetic-guard-unit") {
  return parseAbusePolicy({ mode: "test", enabled: true, json: JSON.stringify({
    namespace, budgets: Object.fromEntries(ruleNames.map((rule) => [rule, { limit: 5, windowMs: 1000 }])),
    pendingPerUser: 2, ttsConcurrency: 1, ttsTaskTimeoutMs: 1000,
  }) });
}
function redisReply() {
  // This is a protocol recorder, not a JS copy of the Lua algorithm. These
  // tests cannot prove Redis atomicity, clock/TTL behavior or multi-PID safety.
  return { eval: vi.fn<AbuseRedisLike["eval"]>().mockResolvedValue([1, 0, 1000]) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("abuse guard protocol and caller boundaries", () => {
  it("merges duplicate buckets before one compound script and hides identities in every key", async () => {
    const redis = redisReply();
    const guard = createAbuseGuard(redis, policy(), secret);
    const identity = "SYNTHETIC_EMAIL@example.invalid";
    await guard.consume([
      { rule: "emailRequestIp", identity, units: 2 },
      { rule: "emailRequestIp", identity, units: 3 },
      { rule: "emailRequestSite", identity: "site" },
    ]);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    const [, count, ...wire] = redis.eval.mock.calls[0];
    expect(count).toBe(2);
    expect(wire.slice(0, count)).toHaveLength(2);
    for (const key of wire.slice(0, count)) {
      expect(key).toMatch(/^unfreq:abuse:v1:[a-f0-9]{64}$/u);
      expect(String(key)).not.toContain(identity);
      expect(String(key)).not.toContain("synthetic-guard-unit");
    }
    expect(JSON.parse(String(wire.at(-1)))).toEqual([
      { rule: "emailRequestIp", units: 5, limit: 5, windowMs: 1000 },
      { rule: "emailRequestSite", units: 1, limit: 5, windowMs: 1000 },
    ]);
  });

  it("separates namespace and secret domains and snapshots caller policy", async () => {
    const redis = redisReply();
    const original = policy();
    const guard = createAbuseGuard(redis, original, secret);
    Object.assign(original.budgets.registerIp, { limit: 99 });
    const charges = [{ rule: "registerIp" as const, identity: "synthetic-ip" }];
    await guard.consume(charges);
    await createAbuseGuard(redis, policy("synthetic-other"), secret).consume(charges);
    await createAbuseGuard(redis, policy(), secret + "other").consume(charges);
    expect(new Set(redis.eval.mock.calls.map((call) => call[2])).size).toBe(3);
    expect(JSON.parse(String(redis.eval.mock.calls[0].at(-1)))[0].limit).toBe(5);
    expect(Object.isFrozen(guard.policy.budgets.registerIp)).toBe(true);
  });

  it("uses the storage window remainder for Retry-After, independent of local Date.now", async () => {
    const redis = redisReply();
    redis.eval.mockResolvedValue([0, 2, 1999]);
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("local clock must not be used"); });
    await expect(createAbuseGuard(redis, policy(), secret).consume([
      { rule: "registerIp", identity: "synthetic-ip" }, { rule: "registerSite", identity: "site" },
    ])).rejects.toMatchObject({ statusCode: 429, rule: "registerSite", retryAfterSeconds: 2 });
  });

  it("passes a zero budget to the script as deny and preserves its actual remainder", async () => {
    const redis = redisReply();
    redis.eval.mockResolvedValue([0, 1, 864001]);
    const explicit = policy();
    Object.assign(explicit.budgets.ttsCharactersSite, { limit: 0 });
    await expect(createAbuseGuard(redis, explicit, secret).authorizeProviderDispatch("tts", 10))
      .rejects.toMatchObject({ statusCode: 429, rule: "ttsCharactersSite", retryAfterSeconds: 865 });
    expect(JSON.parse(String(redis.eval.mock.calls[0].at(-1)))[0]).toMatchObject({ limit: 0, units: 10 });
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects nonrepresentable or nonpositive units %s before storage", async (units) => {
    const redis = redisReply();
    await expect(createAbuseGuard(redis, policy(), secret).consume([{ rule: "chatCallsSite", identity: "site", units }]))
      .rejects.toMatchObject({ statusCode: 503, rule: "configuration" });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("rejects an overflowing compound sum without consuming earlier charges", async () => {
    const redis = redisReply();
    await expect(createAbuseGuard(redis, policy(), secret).consume([
      { rule: "chatCallsSite", identity: "site", units: Number.MAX_SAFE_INTEGER },
      { rule: "chatCallsSite", identity: "site", units: 1 },
    ])).rejects.toMatchObject({ statusCode: 503, rule: "configuration" });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("rejects a blank identity instead of creating a shared accidental bucket", async () => {
    const redis = redisReply();
    await expect(createAbuseGuard(redis, policy(), secret).consume([{ rule: "passwordFailureIdentityIp", identity: "" }]))
      .rejects.toMatchObject({ statusCode: 503, rule: "configuration" });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("fails closed for an insufficient HMAC secret without echoing it", () => {
    const weak = "SYNTHETIC_SHORT_SECRET";
    try {
      createAbuseGuard(redisReply(), policy(), weak);
      expect.fail("weak secret was accepted");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 503, rule: "configuration" });
      expect(String(error)).not.toContain(weak);
    }
  });

  it("never retries or exposes raw storage errors, keys or identities", async () => {
    const redis = redisReply();
    const marker = "SYNTHETIC_STORAGE_KEY_AND_CREDENTIAL";
    redis.eval.mockRejectedValue(new Error(marker));
    const guard = createAbuseGuard(redis, policy(), secret);
    try {
      await guard.consume([{ rule: "registerIp", identity: marker }]);
      expect.fail("storage failure was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(AbuseControlStopped);
      expect(error).toMatchObject({ statusCode: 503, rule: "storage", reason: "unavailable" });
      expect(JSON.stringify(error)).not.toContain(marker);
      expect(String(error)).not.toContain(marker);
    }
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it.each([[], [1, 0, 0], [1, 1, 100], [2, 0, 100], ["1", 0, 100]].map((reply) => ({ reply })))("fails closed on malformed reply $reply", async ({ reply }) => {
    const redis = redisReply();
    redis.eval.mockResolvedValue(reply);
    await expect(createAbuseGuard(redis, policy(), secret).consume([{ rule: "registerIp", identity: "synthetic-ip" }]))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("keeps the default test profile disabled without any Redis call", async () => {
    const redis = redisReply();
    const guard = createAbuseGuard(redis, parseAbusePolicy({ mode: "test" }), secret);
    await guard.consume([{ rule: "registerIp", identity: "synthetic-ip" }]);
    await guard.authorizeProviderDispatch("chat");
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it.each([false, true])("cannot use unconfigured development (enabled=%s) to authorize external work", async (enabled) => {
    const redis = redisReply();
    await expect(createAbuseGuard(redis, parseAbusePolicy({ mode: "development", enabled }), secret).authorizeProviderDispatch("chat"))
      .rejects.toMatchObject({ statusCode: 503, rule: "configuration" });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("rejects an undefined global policy rather than quietly allowing a mock/default caller", () => {
    expect(() => getAbuseGuard()).toThrow(AbuseControlStopped);
  });

  it("retains a control error across ordinary fallback handling", () => {
    const stopped = new AbuseControlStopped("limited", "chatCallsSite", 1001);
    expect(() => throwIfAbuseStopped(stopped)).toThrow(stopped);
    expect(() => throwIfAbuseStopped(new Error("ordinary error"))).not.toThrow();
  });
});

describe("private reservation lifecycle", () => {
  it.each(["COMMITTED", "REFUNDED"] as const)("makes %s terminal and idempotent without a second mutation", async (outcome) => {
    const redis = redisReply();
    redis.eval.mockResolvedValueOnce([1, 0, 1000]).mockResolvedValueOnce(outcome);
    const reservation = await createAbuseGuard(redis, policy(), secret).reserve([{ rule: "generationDailyUser", identity: "synthetic-user" }]);
    if (outcome === "COMMITTED") expect(await reservation.commit()).toBe(outcome);
    else expect(await reservation.refund()).toBe(outcome);
    expect(await reservation.commit()).toBe(outcome);
    expect(await reservation.refund()).toBe(outcome);
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent commit/refund and does not refund after commit", async () => {
    const redis = redisReply();
    let complete!: (value: string) => void;
    redis.eval.mockResolvedValueOnce([1, 0, 1000]).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const reservation = await createAbuseGuard(redis, policy(), secret).reserve([{ rule: "generationDailyUser", identity: "synthetic-user" }]);
    const committing = reservation.commit();
    const refunding = reservation.refund();
    expect(redis.eval).toHaveBeenCalledTimes(2);
    complete("COMMITTED");
    expect(await committing).toBe("COMMITTED");
    expect(await refunding).toBe("COMMITTED");
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("blocks a refund after an unknown commit reply instead of retrying or guessing", async () => {
    const redis = redisReply();
    redis.eval.mockResolvedValueOnce([1, 0, 1000]).mockRejectedValueOnce(new Error("synthetic connection lost"));
    const reservation = await createAbuseGuard(redis, policy(), secret).reserve([{ rule: "generationDailyUser", identity: "synthetic-user" }]);
    await expect(reservation.commit()).rejects.toMatchObject({ statusCode: 503 });
    await expect(reservation.refund()).rejects.toMatchObject({ statusCode: 503 });
    await expect(reservation.commit()).rejects.toMatchObject({ statusCode: 503 });
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("does not return a refundable handle or retry after an unknown reserve reply", async () => {
    const redis = redisReply();
    redis.eval.mockRejectedValueOnce(new Error("synthetic unknown execution"));
    await expect(createAbuseGuard(redis, policy(), secret).reserve([{ rule: "generationDailyUser", identity: "synthetic-user" }]))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("uses distinct random private tokens, never raw identity or token as Redis keys", async () => {
    const redis = redisReply();
    const guard = createAbuseGuard(redis, policy(), secret);
    const a = await guard.reserve([{ rule: "generationDailyUser", identity: "synthetic-private-user" }]);
    const b = await guard.reserve([{ rule: "generationDailyUser", identity: "synthetic-private-user" }]);
    expect(a.token).not.toBe(b.token);
    const keys = redis.eval.mock.calls.map((call) => call.slice(2, 2 + call[1]));
    expect(keys[0][0]).toBe(keys[1][0]);
    expect(keys[0][1]).not.toBe(keys[1][1]);
    expect(JSON.stringify(keys)).not.toContain(a.token);
    expect(JSON.stringify(keys)).not.toContain(b.token);
    expect(JSON.stringify(keys)).not.toContain("synthetic-private-user");
  });
});

describe("concurrency lease protocol", () => {
  it("asserts ownership and makes release idempotent, with no local fallback", async () => {
    const redis = redisReply();
    redis.eval.mockResolvedValueOnce([1, 1000, 1100]).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const lease = await createAbuseGuard(redis, policy(), secret).acquireConcurrency("synthetic-tts", 1, 1000, 100);
    expect(lease.remainingMs).toBe(1000);
    await lease.assertActive();
    await lease.release();
    await lease.release();
    await expect(lease.assertActive()).rejects.toMatchObject({ statusCode: 503, reason: "expired" });
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });

  it("returns the actual active lease remainder when capacity is full", async () => {
    const redis = redisReply();
    redis.eval.mockResolvedValue([0, 2750, 0]);
    await expect(createAbuseGuard(redis, policy(), secret).acquireConcurrency("synthetic-tts", 1, 1000, 100))
      .rejects.toMatchObject({ statusCode: 429, rule: "concurrency", retryAfterSeconds: 3 });
  });

  it("rejects expired ownership and never retries an uncertain release", async () => {
    const redis = redisReply();
    redis.eval.mockResolvedValueOnce([1, 1000, 1100]).mockResolvedValueOnce(0).mockRejectedValueOnce(new Error("synthetic release unknown"));
    const lease = await createAbuseGuard(redis, policy(), secret).acquireConcurrency("synthetic-tts", 1, 1000, 100);
    await expect(lease.assertActive()).rejects.toMatchObject({ statusCode: 503, reason: "expired" });
    await expect(lease.release()).rejects.toMatchObject({ statusCode: 503 });
    await expect(lease.release()).rejects.toMatchObject({ statusCode: 503 });
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });
});
