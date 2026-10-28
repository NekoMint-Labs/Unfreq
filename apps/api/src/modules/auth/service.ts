import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
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

function createFrequencyCodeCandidates(frequencyCode: string): string[] {
  const compact = frequencyCode.trim().toUpperCase().replace(/^FM[\s-]*/, "");

  return [`FM ${compact}`, `FM-${compact}`];
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

function isLoginChallengeRecord(value: unknown): value is LoginChallengeRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "attemptCount" in value &&
    "codeHash" in value &&
    "createdAt" in value &&
    "email" in value &&
    "expiresAt" in value &&
    typeof value.attemptCount === "number" &&
    typeof value.codeHash === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.email === "string" &&
    typeof value.expiresAt === "string"
  );
}

function parseLoginChallengeRecord(serializedRecord: string): LoginChallengeRecord | undefined {
  try {
    const parsed = JSON.parse(serializedRecord) as unknown;
    return isLoginChallengeRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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

function secondsUntil(isoDate: string): number {
  return Math.ceil((Date.parse(isoDate) - Date.now()) / 1000);
}

async function readRetryAfterSeconds(redis: Redis, key: string): Promise<number> {
  const ttl = await redis.ttl(key);
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
  const normalizedEmail = normalizeEmail(email);
  const emailHash = createEmailHash(normalizedEmail);
  const cooldownKey = createLoginRequestCooldownKey(emailHash);
  const cooldownCreated = await redis.set(
    cooldownKey,
    "1",
    "EX",
    env.authLoginRequestCooldownSeconds,
    "NX",
  );

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

  await redis.set(
    createLoginChallengeKey(emailHash),
    JSON.stringify(record),
    "EX",
    env.authLoginChallengeTtlSeconds,
  );

  return {
    challenge: {
      expiresAt,
      retryAfterSeconds: env.authLoginRequestCooldownSeconds,
    },
    delivery: env.authLoginCodeResponseEnabled
      ? {
          code,
          mode: env.authLoginDeliveryMode,
        }
      : {
          mode: env.authLoginDeliveryMode,
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

  if (user === undefined || user.passwordHash === null) {
    throw new AppError("UNAUTHORIZED", "Invalid frequency or password.");
  }

  const isValidPassword = await verifyPassword(body.password, user.passwordHash);

  if (!isValidPassword) {
    throw new AppError("UNAUTHORIZED", "Invalid frequency or password.");
  }

  if (user.status === "BANNED") {
    throw new AppError("FORBIDDEN", "This frequency cannot login now.");
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
  const normalizedEmail = normalizeEmail(params.email);
  const normalizedCode = params.code.trim();
  const emailHash = createEmailHash(normalizedEmail);
  const challengeKey = createLoginChallengeKey(emailHash);
  const serializedRecord = await redis.get(challengeKey);

  if (serializedRecord === null) {
    throw new AppError("UNAUTHORIZED", "Verification challenge expired or missing.", {
      reason: "MISSING",
    });
  }

  const record = parseLoginChallengeRecord(serializedRecord);

  if (record === undefined || record.email !== normalizedEmail) {
    await redis.del(challengeKey);
    throw new AppError("UNAUTHORIZED", "Verification challenge expired or missing.", {
      reason: "INVALID_CHALLENGE",
    });
  }

  const remainingSeconds = secondsUntil(record.expiresAt);

  if (remainingSeconds <= 0) {
    await redis.del(challengeKey);
    throw new AppError("UNAUTHORIZED", "Verification challenge expired.", {
      reason: "EXPIRED",
    });
  }

  if (!safeEqual(hashLoginCode(normalizedCode), record.codeHash)) {
    const attemptCount = record.attemptCount + 1;

    if (attemptCount >= env.authLoginMaxVerifyAttempts) {
      await redis.del(challengeKey);
      throw new AppError("RATE_LIMITED", "Too many verification attempts.", {
        limitType: "AUTH_LOGIN_VERIFY",
      });
    }

    await redis.set(
      challengeKey,
      JSON.stringify({
        ...record,
        attemptCount,
      }),
      "EX",
      remainingSeconds,
    );

    throw new AppError("UNAUTHORIZED", "Invalid verification code.", {
      remainingAttempts: env.authLoginMaxVerifyAttempts - attemptCount,
    });
  }

  await redis.del(challengeKey);

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
