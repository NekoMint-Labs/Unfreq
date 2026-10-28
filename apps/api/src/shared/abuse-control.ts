import { createHmac, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { parseAbusePolicy, ruleNames, type AbusePolicy, type AbuseRuleName } from "../config/abuse.js";
import { env } from "../config/env.js";
import { AbuseControlStopped } from "./abuse-errors.js";

export type AbuseCharge = Readonly<{ rule: AbuseRuleName; identity: string; units?: number }>;
export type AbuseRedisLike = {
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
};
export type ReservationOutcome = "COMMITTED" | "REFUNDED" | "EXPIRED";
export type AbuseReservation = Readonly<{
  token: string;
  commit(): Promise<ReservationOutcome>;
  refund(): Promise<ReservationOutcome>;
}>;
export type AbuseConcurrencyLease = Readonly<{
  token: string;
  remainingMs: number;
  assertActive(): Promise<void>;
  release(): Promise<void>;
}>;
export type ProviderDispatchKind = "chat" | "embedding" | "reranker" | "tts";
export type AbuseGuard = Readonly<{
  policy: AbusePolicy;
  consume(charges: ReadonlyArray<AbuseCharge>): Promise<void>;
  reserve(charges: ReadonlyArray<AbuseCharge>): Promise<AbuseReservation>;
  acquireConcurrency(scope: string, capacity: number, workMs: number, drainMs: number): Promise<AbuseConcurrencyLease>;
  authorizeProviderDispatch(kind: ProviderDispatchKind, units?: number): Promise<void>;
}>;

// Each script validates/reads all state before applying mutations. A Redis Lua
// runtime error does not roll back earlier writes; do not mutate during checks.
const redisClock = `
local tm = redis.call('TIME')
local seconds = tonumber(tm[1])
local micros = tonumber(tm[2])
if not seconds or not micros or seconds < 0 or seconds % 1 ~= 0 or seconds > 9007199254740
  or micros < 0 or micros >= 1000000 or micros % 1 ~= 0 then return redis.error_reply('abuse invalid clock') end
local now = seconds * 1000 + math.floor(micros / 1000)
if now > 9007199254740991 then return redis.error_reply('abuse clock overflow') end
`;

const quotaScript = `${redisClock}
local charges = cjson.decode(ARGV[2])
local states = {}
local denied = 0
local retry = 0
local maxEnd = now
if ARGV[1] == 'reserve' and redis.call('EXISTS', KEYS[#KEYS]) ~= 0 then
  return redis.error_reply('abuse reservation collision')
end
for i, charge in ipairs(charges) do
  local start = now - math.fmod(now, charge.windowMs)
  if start > 9007199254740991 - charge.windowMs then return redis.error_reply('abuse window overflow') end
  local finish = start + charge.windowMs
  local old = redis.call('HMGET', KEYS[i], 'window', 'used')
  local used = 0
  if old[1] and tonumber(old[1]) == start then
    used = tonumber(old[2])
    if not used or used < 0 or used > 9007199254740991 or used % 1 ~= 0 then return redis.error_reply('abuse invalid counter') end
  end
  if charge.units > charge.limit or used > charge.limit - charge.units then
    if finish - now > retry then denied = i; retry = finish - now end
  end
  states[i] = { key = KEYS[i], window = string.format('%.0f', start),
    units = string.format('%.0f', charge.units), used = used + charge.units, finish = finish }
  if finish > maxEnd then maxEnd = finish end
end
if denied ~= 0 then return {0, denied, retry} end
local entries = {}
for i, state in ipairs(states) do
  entries[i] = { key = state.key, window = state.window, units = state.units,
    finish = string.format('%.0f', state.finish) }
end
local serialized = cjson.encode(entries)
for i, state in ipairs(states) do
  redis.call('HSET', state.key, 'window', state.window, 'used', string.format('%.0f', state.used))
  redis.call('PEXPIREAT', state.key, string.format('%.0f', state.finish))
end
if ARGV[1] == 'reserve' then
  redis.call('HSET', KEYS[#KEYS], 'state', 'PENDING', 'entries', serialized)
  redis.call('PEXPIREAT', KEYS[#KEYS], string.format('%.0f', maxEnd))
end
return {1, 0, maxEnd - now}
`;

const reservationScript = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'EXPIRED' end
if state == 'COMMITTED' or state == 'REFUNDED' then return state end
if state ~= 'PENDING' then return redis.error_reply('abuse invalid reservation') end
if ARGV[1] == 'commit' then
  redis.call('HSET', KEYS[1], 'state', 'COMMITTED')
  return 'COMMITTED'
end
local encoded = redis.call('HGET', KEYS[1], 'entries')
if not encoded then return redis.error_reply('abuse invalid reservation') end
local entries = cjson.decode(encoded)
local updates = {}
for _, entry in ipairs(entries) do
  local bucket = redis.call('HMGET', entry.key, 'window', 'used')
  if bucket[1] and bucket[1] == entry.window then
    local used = tonumber(bucket[2])
    local units = tonumber(entry.units)
    local finish = tonumber(entry.finish)
    if not used or not units or not finish or finish <= 0 or finish > 9007199254740991 or finish % 1 ~= 0
      or used < units or used > 9007199254740991 or used % 1 ~= 0 or units <= 0 or units > 9007199254740991 or units % 1 ~= 0 then
      return redis.error_reply('abuse invalid refund')
    end
    updates[#updates + 1] = { key = entry.key, used = string.format('%.0f', used - units), finish = entry.finish }
  end
end
for _, update in ipairs(updates) do
  redis.call('HSET', update.key, 'used', update.used)
  redis.call('PEXPIREAT', update.key, update.finish)
end
redis.call('HSET', KEYS[1], 'state', 'REFUNDED')
return 'REFUNDED'
`;

const acquireScript = `${redisClock}
local capacity = tonumber(ARGV[1])
if now > 9007199254740991 - tonumber(ARGV[2]) then return redis.error_reply('abuse lease overflow') end
local workUntil = now + tonumber(ARGV[2])
if workUntil > 9007199254740991 - tonumber(ARGV[3]) then return redis.error_reply('abuse lease overflow') end
local leaseUntil = workUntil + tonumber(ARGV[3])
if leaseUntil > 9007199254740991 then return redis.error_reply('abuse invalid lease duration') end
-- Read/check types and token collision before changing any state.
local active = redis.call('ZCOUNT', KEYS[1], '(' .. string.format('%.0f', now), '+inf')
if redis.call('EXISTS', KEYS[2]) ~= 0 then return redis.error_reply('abuse lease collision') end
if active >= capacity then
  local first = redis.call('ZRANGEBYSCORE', KEYS[1], '(' .. string.format('%.0f', now), '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
  return {0, math.max(1, tonumber(first[2]) - now), 0}
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', string.format('%.0f', now))
redis.call('ZADD', KEYS[1], string.format('%.0f', leaseUntil), ARGV[4])
redis.call('HSET', KEYS[2], 'member', ARGV[4], 'scope', KEYS[1],
  'workUntil', string.format('%.0f', workUntil), 'leaseUntil', string.format('%.0f', leaseUntil))
redis.call('PEXPIREAT', KEYS[2], string.format('%.0f', leaseUntil))
local last = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIREAT', KEYS[1], string.format('%.0f', tonumber(last[2])))
return {1, workUntil - now, leaseUntil - now}
`;

const leaseScript = `${redisClock}
local owner = redis.call('HMGET', KEYS[2], 'member', 'scope', 'workUntil', 'leaseUntil')
if not owner[1] then return 0 end
if owner[1] ~= ARGV[2] or owner[2] ~= KEYS[1] then return redis.error_reply('abuse invalid owner') end
local score = redis.call('ZSCORE', KEYS[1], ARGV[2])
if ARGV[1] == 'assert' then
  if not score or tonumber(score) ~= tonumber(owner[4]) or tonumber(owner[3]) <= now then return 0 end
  return 1
end
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('DEL', KEYS[2])
return 1
`;

function unavailable(): AbuseControlStopped { return new AbuseControlStopped("unavailable", "storage"); }
function positive(value: number, zero = false): boolean {
  return Number.isSafeInteger(value) && value >= (zero ? 0 : 1);
}
function opaqueIdentity(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 4096; }
function vector(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => !Number.isSafeInteger(item) || item < 0)) throw unavailable();
  return value as number[];
}

export function createAbuseGuard(redisLike: AbuseRedisLike, policy: AbusePolicy, secret: string): AbuseGuard {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32 ||
      typeof policy?.enabled !== "boolean" || typeof policy.configured !== "boolean") {
    throw new AbuseControlStopped("unavailable", "configuration");
  }
  // Snapshot/deep-validate caller configuration: later mutation must not change
  // a guard's namespace, windows or budgets between validation and use.
  let checked: AbusePolicy;
  try {
    const { namespace, budgets, pendingPerUser, ttsConcurrency, ttsTaskTimeoutMs } = policy;
    checked = { ...parseAbusePolicy({ mode: "test", enabled: policy.enabled,
      json: JSON.stringify({ namespace, budgets, pendingPerUser, ttsConcurrency, ttsTaskTimeoutMs }) }), configured: policy.configured };
  } catch { throw new AbuseControlStopped("unavailable", "configuration"); }
  for (const budget of Object.values(checked.budgets)) Object.freeze(budget);
  Object.freeze(checked.budgets);
  Object.freeze(checked);
  const key = (domain: string, rule: string, identity: string) => "unfreq:abuse:v1:" +
    createHmac("sha256", secret).update(JSON.stringify([domain, checked.namespace, rule, identity])).digest("hex");
  async function evaluate(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    try { return await redisLike.eval(script, keys.length, ...keys, ...args); }
    catch { throw unavailable(); }
  }
  function normalize(charges: ReadonlyArray<AbuseCharge>) {
    if (!Array.isArray(charges) || charges.length < 1 || charges.length > 64) throw new AbuseControlStopped("unavailable", "configuration");
    const typedCharges: ReadonlyArray<AbuseCharge> = charges;
    const merged = new Map<string, { rule: AbuseRuleName; units: number; limit: number; windowMs: number }>();
    for (const charge of typedCharges) {
      if (typeof charge !== "object" || charge === null || !ruleNames.includes(charge.rule) || !opaqueIdentity(charge.identity) || !positive(charge.units ?? 1)) {
        throw new AbuseControlStopped("unavailable", "configuration");
      }
      const bucket = key("budget", charge.rule, charge.identity);
      const budget = checked.budgets[charge.rule];
      const previous = merged.get(bucket);
      const units = (previous?.units ?? 0) + (charge.units ?? 1);
      if (!positive(units)) throw new AbuseControlStopped("unavailable", "configuration");
      merged.set(bucket, { rule: charge.rule, units, ...budget });
    }
    return [...merged.entries()];
  }
  async function charge(mode: "consume" | "reserve", charges: ReadonlyArray<AbuseCharge>, reservationKey?: string) {
    const entries = normalize(charges);
    if (!checked.enabled) return;
    const keys = entries.map(([bucket]) => bucket);
    if (reservationKey !== undefined) keys.push(reservationKey);
    const result = vector(await evaluate(quotaScript, keys, [mode, JSON.stringify(entries.map(([, budget]) => budget))]), 3);
    if (result[0] === 0 && result[1] >= 1 && result[1] <= entries.length && result[2] > 0) {
      throw new AbuseControlStopped("limited", entries[result[1] - 1][1].rule, result[2]);
    }
    if (result[0] !== 1 || result[1] !== 0 || result[2] <= 0) throw unavailable();
  }

  const guard: AbuseGuard = {
    policy: checked,
    consume(charges) { return charge("consume", charges); },
    async reserve(charges) {
      const token = randomBytes(24).toString("base64url");
      const reservationKey = key("reservation", "private", token);
      await charge("reserve", charges, reservationKey);
      let state: "PENDING" | "UNCERTAIN" | ReservationOutcome = "PENDING";
      let changing: Promise<ReservationOutcome> | undefined;
      async function change(mode: "commit" | "refund"): Promise<ReservationOutcome> {
        if (changing !== undefined) { await changing; return change(mode); }
        if (state === "UNCERTAIN") throw unavailable();
        if (state !== "PENDING") return state;
        changing = (async () => {
          try {
            const result = checked.enabled ? await evaluate(reservationScript, [reservationKey], [mode]) :
              mode === "commit" ? "COMMITTED" : "REFUNDED";
            if (result !== "COMMITTED" && result !== "REFUNDED" && result !== "EXPIRED") throw unavailable();
            state = result;
            return result;
          } catch { state = "UNCERTAIN"; throw unavailable(); }
        })();
        try { return await changing; } finally { changing = undefined; }
      }
      return { token, commit: () => change("commit"), refund: () => change("refund") };
    },
    async acquireConcurrency(scope, capacity, workMs, drainMs) {
      if (!opaqueIdentity(scope) || !positive(capacity) || !positive(workMs) || !positive(drainMs, true) || !positive(workMs + drainMs)) {
        throw new AbuseControlStopped("unavailable", "configuration");
      }
      const token = randomBytes(24).toString("base64url");
      const scopeKey = key("concurrency", "scope", scope);
      const ownerKey = key("concurrency", "owner", token);
      const member = key("concurrency", "member", token);
      const result = checked.enabled ? vector(await evaluate(acquireScript, [scopeKey, ownerKey], [capacity, workMs, drainMs, member]), 3) : [1, workMs, workMs + drainMs];
      if (result[0] === 0 && result[1] > 0) throw new AbuseControlStopped("limited", "concurrency", result[1]);
      if (result[0] !== 1 || result[1] <= 0) throw unavailable();
      let released = false;
      let uncertain = false;
      let releasing: Promise<void> | undefined;
      return {
        token, remainingMs: result[1],
        async assertActive() {
          if (uncertain) throw unavailable();
          if (released) throw new AbuseControlStopped("expired", "concurrency");
          if (!checked.enabled) return;
          const active = await evaluate(leaseScript, [scopeKey, ownerKey], ["assert", member]);
          if (active !== 1) throw new AbuseControlStopped("expired", "concurrency");
        },
        release() {
          if (releasing !== undefined) return releasing;
          if (uncertain) return Promise.reject(unavailable());
          if (released) return Promise.resolve();
          releasing = (async () => {
            try {
              const result = checked.enabled ? await evaluate(leaseScript, [scopeKey, ownerKey], ["release", member]) : 1;
              if (result !== 0 && result !== 1) throw unavailable();
              released = true;
            } catch { uncertain = true; throw unavailable(); }
          })();
          return releasing;
        },
      };
    },
    async authorizeProviderDispatch(kind, units = 1) {
      const rules: Record<ProviderDispatchKind, AbuseRuleName> = {
        chat: "chatCallsSite", embedding: "embeddingCallsSite", reranker: "rerankerCallsSite", tts: "ttsCharactersSite",
      };
      if (!checked.configured || !Object.hasOwn(rules, kind)) throw new AbuseControlStopped("unavailable", "configuration");
      await guard.consume([{ rule: rules[kind], identity: "site", units }]);
    },
  };
  return guard;
}

let globalControl: { guard: AbuseGuard; close(): Promise<void> } | undefined;

export function getAbuseGuard(): AbuseGuard {
  if (env.abusePolicy === undefined) throw new AbuseControlStopped("unavailable", "configuration");
  if (globalControl !== undefined) return globalControl.guard;
  let closed = false;
  let connecting: Promise<void> | undefined;
  let redis: Redis;
  try {
    redis = new Redis(env.redisUrl, {
      lazyConnect: true, connectTimeout: env.healthDependencyTimeoutMs, commandTimeout: env.healthDependencyTimeoutMs,
      enableReadyCheck: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
      retryStrategy: () => null, autoResendUnfulfilledCommands: false, autoResubscribe: false,
    });
  } catch { throw unavailable(); }
  redis.on("error", () => { /* Caller receives only the safe storage control error. */ });
  async function ensureConnected() {
    if (closed) throw unavailable();
    if (redis.status === "ready") return;
    if (connecting !== undefined) return connecting;
    if (redis.status !== "wait" && redis.status !== "end") throw unavailable();
    connecting = redis.connect().then(() => { if (closed || redis.status !== "ready") throw unavailable(); });
    try { await connecting; } finally { connecting = undefined; }
  }
  const guard = createAbuseGuard({
    async eval(script, keyCount, ...args) {
      await ensureConnected();
      if (closed) throw unavailable();
      return redis.eval(script, keyCount, ...args);
    },
  }, env.abusePolicy, env.abuseHmacSecret);
  globalControl = { guard, close() {
    closed = true;
    return new Promise<void>((resolve) => {
      redis.once("end", resolve);
      redis.disconnect(false);
      if (redis.status === "end") { redis.removeListener("end", resolve); resolve(); }
    });
  } };
  return guard;
}

export async function closeAbuseControl(): Promise<void> {
  const owned = globalControl;
  globalControl = undefined;
  await owned?.close();
}

export function consumeAbuse(charges: ReadonlyArray<AbuseCharge>): Promise<void> { return getAbuseGuard().consume(charges); }
export function reserveAbuse(charges: ReadonlyArray<AbuseCharge>): Promise<AbuseReservation> { return getAbuseGuard().reserve(charges); }
export function acquireAbuseConcurrency(scope: string, capacity: number, workMs: number, drainMs: number): Promise<AbuseConcurrencyLease> {
  return getAbuseGuard().acquireConcurrency(scope, capacity, workMs, drainMs);
}
export function authorizeProviderDispatch(kind: ProviderDispatchKind, units = 1): Promise<void> {
  return getAbuseGuard().authorizeProviderDispatch(kind, units);
}
