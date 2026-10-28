import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { createFrequencyCodeCandidates } from "./identity.js";
import {
  createPasswordFrequencyUser,
  createUser,
  findUserByEmail,
  findUserByFreqCode,
  findUserById,
} from "./repository.js";
import type {
  FrequencyLoginBody,
  RegisterFrequencyBody,
} from "./schemas.js";
import type {
  AuthenticatedFrequency,
  AuthUserRecord,
  FrequencyIdentity,
  LoginChallengeIssueResult,
  LoginResult,
} from "./types.js";

const sessionTtlSeconds = 60 * 60 * 24 * 30;
const sessionVersion = "v1";
const loginChallengeKeyPrefix = "auth:login:challenge";
const loginRequestCooldownKeyPrefix = "auth:login:request-cooldown";
const loginCodeMax = 1_000_000;
const scryptAsync = promisify(scrypt);
const dummyPasswordHash = `scrypt:unfreq-dummy-login-v1:${Buffer.alloc(64).toString("base64url")}`;

export class PasswordLoginForbidden extends AppError {
  constructor() { super("FORBIDDEN", "This frequency cannot login now."); }
}

function assertEmailDeliveryAllowed(): void {
  if (env.authLoginDeliveryMode !== "local-log" || env.isProduction) {
    throw new AppError("FORBIDDEN", "Email login is unavailable.");
  }
}

async function authStorage<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch { throw new AppError("AI_UNAVAILABLE", "Authentication temporarily unavailable."); }
}

// Redis owns expiry and serialization. KEEPTTL preserves the original absolute
// expiry, even on a wrong attempt; successful validation consumes the key in
// this same command. Unit eval doubles test only this storage contract.
const verifyChallengeScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {-1, 0, 0} end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then redis.call('DEL', KEYS[1]); return {-1, 0, 0} end
local ok, record = pcall(cjson.decode, raw)
local maximum = tonumber(ARGV[3])
if not ok or type(record) ~= 'table' or record.email ~= ARGV[1]
  or type(record.codeHash) ~= 'string' or type(record.attemptCount) ~= 'number'
  or record.attemptCount < 0 or record.attemptCount ~= math.floor(record.attemptCount) then
  redis.call('DEL', KEYS[1]); return {-2, 0, 0}
end
local function exhausted()
  redis.call('DEL', KEYS[1])
  local cooldown = redis.call('PTTL', KEYS[2])
  return {-3, 0, math.max(1, math.ceil(cooldown / 1000))}
end
if record.attemptCount >= maximum then return exhausted() end
if record.codeHash ~= ARGV[2] then
  record.attemptCount = record.attemptCount + 1
  if record.attemptCount >= maximum then return exhausted() end
  redis.call('SET', KEYS[1], cjson.encode(record), 'KEEPTTL')
  return {0, maximum - record.attemptCount, 0}
end
redis.call('DEL', KEYS[1])
return {1, 0, 0}
`;

type SessionPayload = {
  exp: number;
  sub: string;
};

type LoginChallengeRecord = {
  attemptCount: number;
  codeHash: string;
  createdAt: string;
  email: string;
  expiresAt: string;
};

function toFrequencyIdentity(user: AuthUserRecord): FrequencyIdentity {
  return {
    createdAt: user.createdAt.toISOString(),
    frequencyName: user.frequencyName ?? undefined,
    freqCode: user.freqCode,
    id: user.id,
    isGuest: user.isGuest,
    role: user.role,
    status: user.status,
  };
}

function toAuthenticatedFrequency(user: AuthUserRecord): AuthenticatedFrequency {
  return toFrequencyIdentity(user);
}

function sign(value: string): string {
  return createHmac("sha256", env.sessionSecret).update(value).digest("base64url");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createEmailHash(email: string): string {
  return sign(`login-email:${email}`);
}

function createLoginChallengeKey(emailHash: string): string {
  return `${loginChallengeKeyPrefix}:${emailHash}`;
}

function createLoginRequestCooldownKey(emailHash: string): string {
  return `${loginRequestCooldownKeyPrefix}:${emailHash}`;
}

function hashLoginCode(code: string): string {
  return sign(`login-code:${code}`);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  return `scrypt:${salt}:${derivedKey.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, salt, hash, extra] = storedHash.split(":");

  if (scheme !== "scrypt" || salt === undefined || hash === undefined || extra !== undefined) {
    return false;
  }

  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  return safeEqual(derivedKey.toString("base64url"), hash);
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): SessionPayload | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "exp" in parsed &&
      "sub" in parsed &&
      typeof parsed.exp === "number" &&
      typeof parsed.sub === "string"
    ) {
      return {
        exp: parsed.exp,
        sub: parsed.sub,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function generateLoginCode(): string {
  return randomInt(0, loginCodeMax).toString().padStart(6, "0");
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  const visiblePrefix = (localPart ?? "").slice(0, 2);
  const maskedLocalPart = visiblePrefix.length > 0 ? `${visiblePrefix}***` : "***";

  return `${maskedLocalPart}@${domain ?? "unknown"}`;
}

async function readRetryAfterSeconds(redis: Redis, key: string): Promise<number> {
  const ttl = await authStorage(() => redis.ttl(key));
  return ttl > 0 ? ttl : env.authLoginRequestCooldownSeconds;
}

function createSessionToken(userId: string): string {
  const payload = encodePayload({
    exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds,
    sub: userId,
  });
  const signature = sign(`${sessionVersion}.${payload}`);

  return `${sessionVersion}.${payload}.${signature}`;
}

function readSessionToken(token: string): SessionPayload | undefined {
  const [version, encodedPayload, signature, extra] = token.split(".");

  if (
    version !== sessionVersion ||
    encodedPayload === undefined ||
    signature === undefined ||
    extra !== undefined
  ) {
    return undefined;
  }

  const expectedSignature = sign(`${version}.${encodedPayload}`);

  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }

  const payload = decodePayload(encodedPayload);

  if (payload === undefined || payload.exp <= Math.floor(Date.now() / 1000)) {
    return undefined;
  }

  return payload;
}

async function generateUniqueFreqCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const left = randomInt(0, 100).toString().padStart(2, "0");
    const right = randomInt(0, 100).toString().padStart(2, "0");
    const freqCode = `FM ${left}.${right}`;
    const existing = await findUserByFreqCode(freqCode);

    if (existing === undefined) {
      return freqCode;
    }
  }

  throw new AppError("CONFLICT", "Unable to assign a new FM frequency.");
}

export async function requestLoginChallenge(
  redis: Redis,
  email: string,
): Promise<LoginChallengeIssueResult> {
  assertEmailDeliveryAllowed();
  const normalizedEmail = normalizeEmail(email);
  const emailHash = createEmailHash(normalizedEmail);
  const cooldownKey = createLoginRequestCooldownKey(emailHash);
  const cooldownCreated = await authStorage(() => redis.set(
    cooldownKey,
    "1",
    "EX",
    env.authLoginRequestCooldownSeconds,
    "NX",
  ));

  if (cooldownCreated !== "OK") {
    throw new AppError("RATE_LIMITED", "Login challenge request rate limited.", {
      limitType: "AUTH_LOGIN_REQUEST",
      retryAfterSeconds: await readRetryAfterSeconds(redis, cooldownKey),
    });
  }

  const code = generateLoginCode();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + env.authLoginChallengeTtlSeconds * 1000,
  ).toISOString();
  const record: LoginChallengeRecord = {
    attemptCount: 0,
    codeHash: hashLoginCode(code),
    createdAt: now.toISOString(),
    email: normalizedEmail,
    expiresAt,
  };

  const stored = await authStorage(() => redis.set(
    createLoginChallengeKey(emailHash),
    JSON.stringify(record),
    "EX",
    env.authLoginChallengeTtlSeconds,
  ));
  if (stored !== "OK") throw new AppError("AI_UNAVAILABLE", "Authentication temporarily unavailable.");

  return {
    challenge: {
      expiresAt,
      retryAfterSeconds: env.authLoginRequestCooldownSeconds,
    },
    delivery: env.authLoginCodeResponseEnabled
      ? {
          code,
          mode: "local-log",
        }
      : {
          mode: "local-log",
        },
    localDelivery: {
      code,
      emailHash,
      maskedEmail: maskEmail(normalizedEmail),
    },
  };
}

export async function loginWithEmail(email: string): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(email);
  const existingUser = await findUserByEmail(normalizedEmail);
  const user =
    existingUser ??
    (await createUser({
      email: normalizedEmail,
      freqCode: await generateUniqueFreqCode(),
    }));

  return {
    frequency: toFrequencyIdentity(user),
    isNewFrequency: existingUser === undefined,
    sessionToken: createSessionToken(user.id),
  };
}

export async function registerFrequency(
  body: RegisterFrequencyBody,
): Promise<LoginResult> {
  const user = await createPasswordFrequencyUser({
    freqCode: await generateUniqueFreqCode(),
    passwordHash: await hashPassword(body.password),
  });

  return {
    frequency: toFrequencyIdentity(user),
    isNewFrequency: true,
    sessionToken: createSessionToken(user.id),
  };
}

export async function loginWithFrequencyCredentials(
  body: FrequencyLoginBody,
): Promise<LoginResult> {
  let user: AuthUserRecord | undefined;

  for (const freqCode of createFrequencyCodeCandidates(body.frequencyCode)) {
    user = await findUserByFreqCode(freqCode);

    if (user !== undefined) {
      break;
    }
  }

  const isValidPassword = await verifyPassword(body.password, user?.passwordHash ?? dummyPasswordHash);

  if (user === undefined || user.passwordHash === null || !isValidPassword) {
    throw new AppError("UNAUTHORIZED", "Invalid frequency or password.");
  }

  if (user.status === "BANNED") {
    throw new PasswordLoginForbidden();
  }

  return {
    frequency: toFrequencyIdentity(user),
    isNewFrequency: false,
    sessionToken: createSessionToken(user.id),
  };
}

export async function verifyLoginChallenge(
  redis: Redis,
  params: {
    code: string;
    email: string;
  },
): Promise<LoginResult> {
  assertEmailDeliveryAllowed();
  const normalizedEmail = normalizeEmail(params.email);
  const normalizedCode = params.code.trim();
  const emailHash = createEmailHash(normalizedEmail);
  const challengeKey = createLoginChallengeKey(emailHash);
  const outcome: unknown = await authStorage(() => redis.eval(verifyChallengeScript, 2, challengeKey,
    createLoginRequestCooldownKey(emailHash), normalizedEmail, hashLoginCode(normalizedCode), env.authLoginMaxVerifyAttempts));
  if (!Array.isArray(outcome) || outcome.length !== 3 ||
      !outcome.every((value) => typeof value === "number" && Number.isSafeInteger(value)) ||
      ![-3, -2, -1, 0, 1].includes(outcome[0]) || outcome[1] < 0 || outcome[1] > env.authLoginMaxVerifyAttempts ||
      outcome[2] < 0) throw new AppError("AI_UNAVAILABLE", "Authentication temporarily unavailable.");
  const [status, remainingAttempts, retryAfterSeconds] = outcome as number[];
  if (status === -1) {
    throw new AppError("UNAUTHORIZED", "Verification challenge expired or missing.", {
      reason: "MISSING",
    });
  }

  if (status === -2) {
    throw new AppError("UNAUTHORIZED", "Verification challenge expired or missing.", {
      reason: "INVALID_CHALLENGE",
    });
  }

  if (status === -3) {
    throw new AppError("RATE_LIMITED", "Too many verification attempts.", {
      limitType: "AUTH_LOGIN_VERIFY", retryAfterSeconds,
    });
  }
  if (status === 0) {
    throw new AppError("UNAUTHORIZED", "Invalid verification code.", {
      remainingAttempts,
    });
  }

  return loginWithEmail(normalizedEmail);
}

export async function authenticateSessionToken(
  sessionToken: string,
): Promise<AuthenticatedFrequency | undefined> {
  const payload = readSessionToken(sessionToken);

  if (payload === undefined) {
    return undefined;
  }

  const user = await findUserById(payload.sub);

  if (user === undefined || user.status === "BANNED" || user.isGuest) {
    return undefined;
  }

  return toAuthenticatedFrequency(user);
}

export function getSessionTtlSeconds(): number {
  return sessionTtlSeconds;
}
