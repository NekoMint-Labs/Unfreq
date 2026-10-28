import { createHmac, randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixtureExpansion, fixtureFingerprint, fixtureSeed } from "./fixtures.js";
import { createIntegrationHarness, recordCoreSetupPhase } from "./harness.js";

type Harness = Awaited<ReturnType<typeof createIntegrationHarness>>;
type Envelope<T> = { data: T };
type Signal = {
  id: string;
  status: string;
  visibility?: string;
  generationStatus?: string;
  expandedText?: string;
  seedText?: string;
};
type LoginResult = {
  frequency: { id: string; freqCode: string };
  sessionToken: string;
};
type Session = {
  cookie: string;
  frequencyCode: string;
  id: string;
  password: string;
};
type ModerationStatus = "DRAFT" | "REVIEWING" | "HIDDEN" | "DELETED" | "PUBLISHED";
type RequestMethod = "GET" | "POST" | "PATCH" | "DELETE";

let h: Harness;
let harnessPreparation: Promise<Harness> | undefined;
let author: Session;
let reader: Session;
let admin: Session;
let publicControlId: string;

async function request(
  method: RequestMethod,
  url: string,
  cookie?: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method,
    url,
    headers: cookie === undefined ? {} : { cookie },
    ...(payload === undefined ? {} : { payload }),
  });
}

function expectError(
  response: Awaited<ReturnType<typeof request>>,
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(response.json()).toMatchObject({ error: { code } });
}

function sessionCookie(response: Awaited<ReturnType<typeof request>>) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : [String(header ?? "")];
  const value = values.find((item) => item.startsWith("unfreq_session="));
  expect(value).toContain("HttpOnly");
  expect(value).toContain("SameSite=Lax");
  expect(value).toContain("Path=/");
  const cookie = value?.split(";")[0];
  expect(cookie).toMatch(/^unfreq_session=.+/u);
  if (cookie === undefined) throw new Error("Registration did not set a session cookie.");
  return cookie;
}

async function register(): Promise<Session> {
  const password = `integration-${randomUUID()}`;
  const response = await request("POST", "/api/auth/register", undefined, { password });
  expect(response.statusCode).toBe(201);
  const result = response.json<Envelope<LoginResult>>().data;
  return {
    cookie: sessionCookie(response),
    frequencyCode: result.frequency.freqCode,
    id: result.frequency.id,
    password,
  };
}

async function createPending(): Promise<string> {
  const response = await request("POST", "/api/signals", author.cookie, { seedText: fixtureSeed });
  expect(response.statusCode).toBe(201);
  const signal = response.json<Envelope<{ signal: Signal }>>().data.signal;
  expect(signal).toMatchObject({
    generationStatus: "RECEIVED",
    seedText: fixtureSeed,
    status: "DRAFT",
    visibility: "GENERATION_OWNER",
  });
  return signal.id;
}

async function waitForPreview(id: string): Promise<Signal> {
  await vi.waitFor(async () => {
    const [row] = await h.sql<{ generation_status: string }[]>`
      select generation_status from signals where id = ${id}
    `;
    expect(row?.generation_status).toBe("COMPLETED");
  }, { interval: 25, timeout: 10_000 });
  const response = await request("GET", `/api/signals/${id}`, author.cookie);
  expect(response.statusCode).toBe(200);
  const signal = response.json<Envelope<{ signal: Signal }>>().data.signal;
  expect(signal).toMatchObject({ id, status: "DRAFT", visibility: "PREVIEW_OWNER" });
  expect(signal.expandedText?.length).toBeGreaterThanOrEqual(80);
  return signal;
}

async function createDraft(): Promise<string> {
  const id = await createPending();
  await waitForPreview(id);
  return id;
}

async function publish(id: string) {
  const response = await request("POST", `/api/signals/${id}/publish`, author.cookie);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ data: { signal: { id, status: "PUBLISHED" } } });
}

async function moderate(id: string, status: ModerationStatus) {
  const response = await request("PATCH", `/api/admin/signals/${id}/status`, admin.cookie, { status });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ data: { signal: { id, status } } });
}

async function expectNotPublic(id: string, reviewing = false) {
  for (const cookie of [undefined, reader.cookie]) {
    const detail = await request("GET", `/api/signals/${id}`, cookie);
    if (reviewing) {
      expect(detail.statusCode).toBe(200);
      const signal = detail.json<Envelope<{ signal: Signal }>>().data.signal;
      expect(signal).toMatchObject({ id, status: "REVIEWING", visibility: "REVIEW_RESTRICTED" });
      expect(Object.keys(signal).sort()).toEqual([
        "createdAt", "id", "status", "updatedAt", "visibility",
      ]);
    } else {
      expectError(detail, 404, "NOT_FOUND");
    }
  }

  for (const suffix of ["matches", "echoes", "audio", "audio/main", "audio/left", "audio/right"]) {
    expectError(await request("GET", `/api/signals/${id}/${suffix}`), 404, "NOT_FOUND");
  }
  for (const [suffix, payload] of [
    ["resonance", {}],
    ["save", {}],
    ["echoes", { content: "Only synthetic integration content." }],
    ["audio", {}],
  ] as const) {
    expectError(await request("POST", `/api/signals/${id}/${suffix}`, reader.cookie, payload), 404, "NOT_FOUND");
  }

  for (const cookie of [undefined, author.cookie, reader.cookie]) {
    const hall = await request("GET", "/api/signals/hall", cookie);
    expect(hall.statusCode).toBe(200);
    const hallIds = hall.json<Envelope<{ signals: Signal[] }>>().data.signals.map((signal) => signal.id);
    expect(hallIds).toContain(publicControlId);
    expect(hallIds).not.toContain(id);

    const galaxy = await request("GET", "/api/signals/galaxy", cookie);
    expect(galaxy.statusCode).toBe(200);
    const points = galaxy.json<Envelope<{ points: Array<{ id: string; matchIds: string[] }> }>>().data.points;
    expect(points.map((point) => point.id)).toContain(publicControlId);
    expect(points.map((point) => point.id)).not.toContain(id);
    expect(points.flatMap((point) => point.matchIds)).not.toContain(id);
  }

  // Only the control remains public at these checkpoints, so random tuning is
  // deterministic; this does not rely on sampling a forbidden row by chance.
  for (const cookie of [undefined, reader.cookie]) {
    const random = await request("GET", "/api/signals/random", cookie);
    expect(random.statusCode).toBe(200);
    expect(random.json()).toMatchObject({ data: { signal: { id: publicControlId } } });
  }
  const matches = await request("GET", `/api/signals/${publicControlId}/matches`);
  expect(matches.statusCode).toBe(200);
  expect(matches.json<Envelope<{ matches: Array<{ id: string }> }>>().data.matches.map((match) => match.id)).not.toContain(id);

  for (const cookie of [author.cookie, reader.cookie]) {
    const saves = await request("GET", "/api/me/saves", cookie);
    expect(saves.statusCode).toBe(200);
    expect(saves.json<Envelope<{ signals: Signal[] }>>().data.signals.map((signal) => signal.id)).not.toContain(id);
  }
}

describe("real API core flow against isolated PostgreSQL and Redis", () => {
  beforeAll(async () => {
    harnessPreparation = createIntegrationHarness();
    h = await harnessPreparation;
    await recordCoreSetupPhase("author-register-start");
    author = await register();
    await recordCoreSetupPhase("author-register-complete");
    reader = await register();
    await recordCoreSetupPhase("reader-register-complete");
    admin = await register();
    await recordCoreSetupPhase("admin-register-complete");
    // Administrator setup affects only the synthetic identity in this run's
    // guarded disposable database. Authentication still uses the real cookie.
    await h.sql`update users set role = 'ADMIN' where id = ${admin.id}`;
    await h.sql`update frequencies set role = 'ADMIN' where id = ${admin.id}`;
    await recordCoreSetupPhase("admin-promoted");
    await recordCoreSetupPhase("control-create-start");
    publicControlId = await createDraft();
    await recordCoreSetupPhase("control-create-complete");
    await publish(publicControlId);
    await recordCoreSetupPhase("control-publish-complete");
  });

  afterAll(async () => {
    // A hook watchdog is not cancellation. Even if preparation finished late,
    // wait for the owned harness and close it instead of abandoning its work.
    const prepared = await harnessPreparation?.catch(() => undefined);
    await prepared?.close();
  });

  it("persists registration, verifies passwords, and authenticates HttpOnly session cookies", async () => {
    const health = await request("GET", "/health/deep");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ data: { dependencies: { postgres: "ok", redis: "ok" } } });

    const [identity] = await h.sql<{ user_id: string; frequency_id: string; password_hash: string }[]>`
      select u.id as user_id, f.id as frequency_id, u.password_hash
      from users u join frequencies f on u.id = f.id where u.id = ${author.id}
    `;
    expect(identity).toMatchObject({ user_id: author.id, frequency_id: author.id });
    expect(identity.password_hash).toMatch(/^scrypt:/u);
    expect(identity.password_hash).not.toBe(author.password);
    expectError(await request("GET", "/api/me"), 401, "UNAUTHORIZED");
    expectError(await request("GET", "/api/me", "unfreq_session=invalid"), 401, "UNAUTHORIZED");
    const me = await request("GET", "/api/me", author.cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ data: { frequency: { id: author.id } } });

    expectError(await request("POST", "/api/auth/frequency/login", undefined, {
      frequencyCode: author.frequencyCode, password: "incorrect-integration-password",
    }), 401, "UNAUTHORIZED");
    const login = await request("POST", "/api/auth/frequency/login", undefined, {
      frequencyCode: author.frequencyCode, password: author.password,
    });
    expect(login.statusCode).toBe(200);
    const loggedInMe = await request("GET", "/api/me", sessionCookie(login));
    expect(loggedInMe.statusCode).toBe(200);
    expect(loggedInMe.json()).toMatchObject({ data: { frequency: { id: author.id } } });
  });

  it("stores expiring Redis challenges without response code disclosure and enforces cooldown, attempt limits, and one-time verification", async () => {
    const authService = await import("../../src/modules/auth/service.js");
    const { env } = await import("../../src/config/env.js");
    // Redis deliberately stores only an HMAC, not a recoverable code. Observe
    // the real local-delivery result without replacing service implementation,
    // randomness, Redis, or the API response; never write the code to output.
    const issueSpy = vi.spyOn(authService, "requestLoginChallenge");
    type ChallengeRecord = {
      attemptCount: number;
      codeHash: string;
      createdAt: string;
      email: string;
      expiresAt: string;
    };
    type ChallengeResponse = {
      challenge: { expiresAt: string; retryAfterSeconds: number };
      delivery: { mode: string };
    };
    const runId = process.env.UNFREQ_INTEGRATION_RUN_ID;
    const sign = (value: string) => createHmac("sha256", env.sessionSecret).update(value).digest("base64url");
    const challengeKeys = (email: string) => {
      const emailHash = sign(`login-email:${email}`);
      return {
        challenge: `auth:login:challenge:${emailHash}`,
        cooldown: `auth:login:request-cooldown:${emailHash}`,
      };
    };
    const readChallenge = async (key: string) => {
      const value = await h.app.redis.get(key);
      if (value === null) throw new Error("Expected this run's synthetic Redis challenge.");
      return JSON.parse(value) as ChallengeRecord;
    };
    const issue = async (email: string) => {
      const response = await request("POST", "/api/auth/login", undefined, { email: email.toUpperCase() });
      expect(response.statusCode).toBe(200);
      const observed = issueSpy.mock.results.at(-1);
      if (observed?.type !== "return") throw new Error("Real challenge issuance did not return a local-delivery result.");
      const issued = await observed.value;
      const code = issued.localDelivery.code;
      expect(/^\d{6}$/u.test(code)).toBe(true);
      const data = response.json<Envelope<ChallengeResponse>>().data;
      expect(Object.keys(data.delivery)).toEqual(["mode"]);
      expect(data.delivery.mode).toBe("local-log");
      expect(Object.hasOwn(data, "localDelivery")).toBe(false);
      expect(Object.hasOwn(data, "code")).toBe(false);
      const keys = challengeKeys(email);
      const record = await readChallenge(keys.challenge);
      expect(Object.keys(record).sort()).toEqual(["attemptCount", "codeHash", "createdAt", "email", "expiresAt"]);
      expect(record).toMatchObject({ attemptCount: 0, email, expiresAt: data.challenge.expiresAt });
      expect(record.codeHash).toBe(sign(`login-code:${code}`));
      expect(Date.parse(record.expiresAt) - Date.parse(record.createdAt)).toBe(env.authLoginChallengeTtlSeconds * 1000);
      const ttl = await h.app.redis.ttl(keys.challenge);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(env.authLoginChallengeTtlSeconds);
      const cooldownTtl = await h.app.redis.ttl(keys.cooldown);
      expect(cooldownTtl).toBeGreaterThan(0);
      expect(cooldownTtl).toBeLessThanOrEqual(env.authLoginRequestCooldownSeconds);
      expect(data.challenge.retryAfterSeconds).toBe(env.authLoginRequestCooldownSeconds);
      return { code, keys, record };
    };

    try {
      const email = `challenge-${runId}-${randomUUID()}@example.invalid`.toLowerCase();
      const first = await issue(email);
      const cooldown = await request("POST", "/api/auth/login", undefined, { email });
      expectError(cooldown, 429, "RATE_LIMITED");
      expect(cooldown.json()).toMatchObject({ error: { details: { limitType: "AUTH_LOGIN_REQUEST", retryAfterSeconds: expect.any(Number) } } });
      expect(await readChallenge(first.keys.challenge)).toEqual(first.record);

      const verified = await request("POST", "/api/auth/login/verify", undefined, { email, code: first.code });
      expect(verified.statusCode).toBe(200);
      const identity = verified.json<Envelope<LoginResult>>().data.frequency;
      const me = await request("GET", "/api/me", sessionCookie(verified));
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ data: { frequency: { id: identity.id } } });
      const [storedUser] = await h.sql<{ id: string; email: string }[]>`
        select id, email from users where id = ${identity.id}
      `;
      expect(storedUser).toEqual({ id: identity.id, email });
      expect(await h.app.redis.exists(first.keys.challenge)).toBe(0);
      expect(await h.app.redis.ttl(first.keys.cooldown)).toBeGreaterThan(0);
      const replay = await request("POST", "/api/auth/login/verify", undefined, { email, code: first.code });
      expectError(replay, 401, "UNAUTHORIZED");
      expect(replay.json()).toMatchObject({ error: { details: { reason: "MISSING" } } });

      const limitedEmail = `attempts-${runId}-${randomUUID()}@example.invalid`.toLowerCase();
      const limited = await issue(limitedEmail);
      const wrongCode = limited.code === "000000" ? "000001" : "000000";
      for (let attempt = 1; attempt <= env.authLoginMaxVerifyAttempts; attempt += 1) {
        const wrong = await request("POST", "/api/auth/login/verify", undefined, { email: limitedEmail, code: wrongCode });
        if (attempt < env.authLoginMaxVerifyAttempts) {
          expectError(wrong, 401, "UNAUTHORIZED");
          expect(wrong.json()).toMatchObject({ error: { details: { remainingAttempts: env.authLoginMaxVerifyAttempts - attempt } } });
          const record = await readChallenge(limited.keys.challenge);
          expect(record.attemptCount).toBe(attempt);
          expect(record.codeHash).toBe(limited.record.codeHash);
          const ttl = await h.app.redis.ttl(limited.keys.challenge);
          expect(ttl).toBeGreaterThan(0);
          expect(ttl).toBeLessThanOrEqual(env.authLoginChallengeTtlSeconds);
        } else {
          expectError(wrong, 429, "RATE_LIMITED");
          expect(wrong.json()).toMatchObject({ error: { details: { limitType: "AUTH_LOGIN_VERIFY" } } });
          expect(await h.app.redis.exists(limited.keys.challenge)).toBe(0);
        }
      }
      expectError(await request("POST", "/api/auth/login/verify", undefined, { email: limitedEmail, code: limited.code }), 401, "UNAUTHORIZED");
      const [limitedUser] = await h.sql<{ count: number }[]>`
        select count(*)::integer as count from users where email = ${limitedEmail}
      `;
      expect(limitedUser.count).toBe(0);
    } finally {
      issueSpy.mockClear();
      issueSpy.mockRestore();
    }
  });

  it("keeps generation and completed previews private until the author explicitly publishes", async () => {
    const hold = h.provider.holdNextRequest();
    let pendingId: string | undefined;
    try {
      const id = await createPending();
      pendingId = id;
      await hold.received;
      const pending = await request("GET", `/api/signals/${id}`, author.cookie);
      expect(pending.statusCode).toBe(200);
      expect(pending.json()).toMatchObject({ data: { signal: { id, visibility: "GENERATION_OWNER" } } });
      expectError(await request("POST", `/api/signals/${id}/publish`, author.cookie), 409, "CONFLICT");
      await expectNotPublic(id);
    } finally {
      hold.release();
    }
    if (pendingId === undefined) throw new Error("Pending signal creation did not return an id.");
    const id = pendingId;
    await waitForPreview(id);
    await expectNotPublic(id);
    expectError(await request("POST", `/api/signals/${id}/publish`), 401, "UNAUTHORIZED");
    expectError(await request("POST", `/api/signals/${id}/publish`, reader.cookie), 404, "NOT_FOUND");
    await publish(id);
    const publicDetail = await request("GET", `/api/signals/${id}`);
    expect(publicDetail.statusCode).toBe(200);
    expect(publicDetail.json()).toMatchObject({ data: { signal: { id, status: "PUBLISHED", seedText: fixtureSeed } } });
    const [stored] = await h.sql<{ generation_status: string; status: string }[]>`
      select generation_status, status from signals where id = ${id}
    `;
    expect(stored).toEqual({ generation_status: "COMPLETED", status: "PUBLISHED" });
    expect(h.provider.tasks).toContain("signal-material");
    await moderate(id, "HIDDEN");
    await expectNotPublic(id);
  });

  it.each(["DRAFT", "REVIEWING", "HIDDEN", "DELETED"] as const)(
    "filters %s from every public reading and interaction surface",
    async (status) => {
      const id = await createDraft();
      if (status !== "DRAFT") await moderate(id, status);
      await expectNotPublic(id, status === "REVIEWING");
      if (status === "DRAFT" || status === "REVIEWING") {
        const own = await request("GET", `/api/signals/${id}`, author.cookie);
        expect(own.statusCode).toBe(200);
        expect(own.json()).toMatchObject({ data: { signal: { id, status, seedText: fixtureSeed } } });
      } else {
        expectError(await request("GET", `/api/signals/${id}`, author.cookie), 404, "NOT_FOUND");
      }
      if (status === "REVIEWING") {
        expectError(await request("POST", `/api/signals/${id}/publish`, author.cookie), 409, "CONFLICT");
      }
    },
  );

  it("rejects a malformed managed PUBLISHED generation at the database boundary", async () => {
    const id = await createDraft();
    await publish(id);
    try {
      await expect(h.sql`update signals set generation_status = 'EXPANDING' where id = ${id}`)
        .rejects.toMatchObject({ code: "23514", constraint_name: "signals_generation_execution_check" });
      const [stored] = await h.sql`select generation_status, status, generation_attempt_count from signals where id = ${id}`;
      expect(stored).toMatchObject({ generation_status: "COMPLETED", status: "PUBLISHED", generation_attempt_count: 1 });
    } finally { await moderate(id, "DRAFT"); }
  });

  it("filters a deliberately inconsistent legacy PUBLISHED row until generation is COMPLETED", async () => {
    // Explicit pre-0022 shape: old NULL-metadata records remain readable and
    // must still pass every public-read filter. Do not weaken the new CHECK
    // or erase execution metadata from a managed row to construct this case.
    const { createSignalDraft } = await import("../../src/modules/signals/repository.js");
    const { buildMinimalSignalProgram } = await import("../../src/modules/signals/service-mappers.js");
    const legacy = await createSignalDraft({
      authorId: author.id, frequencyId: author.id, rawInput: fixtureSeed, seedText: fixtureSeed,
      expandedText: fixtureExpansion.expandedText, fingerprint: fixtureFingerprint,
      galaxyPosition: { x: 0, y: 0, z: 0 }, generationStatus: "EXPANDING", status: "PUBLISHED",
      program: buildMinimalSignalProgram({
        expandedText: fixtureExpansion.expandedText, fingerprint: fixtureFingerprint, rawInput: fixtureSeed,
      }),
    });
    const id = legacy.id;
    const [metadata] = await h.sql`select generation_attempt_count from signals where id = ${id}`;
    expect(metadata).toEqual({ generation_attempt_count: null });
    try {
      await expectNotPublic(id);
      const own = await request("GET", `/api/signals/${id}`, author.cookie);
      expect(own.statusCode).toBe(200);
      expect(own.json()).toMatchObject({ data: { signal: { id, generationStatus: "EXPANDING", visibility: "GENERATION_OWNER" } } });
      expectError(await request("POST", `/api/signals/${id}/publish`, author.cookie), 409, "CONFLICT");
    } finally {
      await h.sql`update signals set generation_status = 'COMPLETED', status = 'DRAFT' where id = ${id}`;
    }
  });

  it("enforces concurrent resonance/save uniqueness and hides previously saved content after moderation", async () => {
    const id = await createDraft();
    await publish(id);
    expectError(await request("POST", `/api/signals/${id}/resonance`, undefined, {}), 401, "UNAUTHORIZED");
    expectError(await request("POST", `/api/signals/${id}/save`), 401, "UNAUTHORIZED");
    expectError(await request("PATCH", `/api/admin/signals/${id}/status`, reader.cookie, { status: "HIDDEN" }), 403, "FORBIDDEN");

    await Promise.all(Array.from({ length: 8 }, async () => {
      const [resonance, save] = await Promise.all([
        request("POST", `/api/signals/${id}/resonance`, reader.cookie, {}),
        request("POST", `/api/signals/${id}/save`, reader.cookie),
      ]);
      expect(resonance.statusCode).toBe(200);
      expect(resonance.json()).toMatchObject({ data: { resonance: { hasResonated: true } } });
      expect(save.statusCode).toBe(200);
      expect(save.json()).toMatchObject({ data: { save: { hasSaved: true } } });
    }));
    const [counts] = await h.sql<{ resonances: number; saves: number; resonance_count: number }[]>`
      select
        (select count(*)::integer from signal_resonances where signal_id = ${id}) as resonances,
        (select count(*)::integer from signal_saves where signal_id = ${id}) as saves,
        resonance_count from signals where id = ${id}
    `;
    expect(counts).toEqual({ resonances: 1, saves: 1, resonance_count: 1 });
    const saved = await request("GET", "/api/me/saves", reader.cookie);
    expect(saved.statusCode).toBe(200);
    expect(saved.json<Envelope<{ signals: Signal[] }>>().data.signals.map((signal) => signal.id)).toContain(id);
    const authorSaves = await request("GET", "/api/me/saves", author.cookie);
    expect(authorSaves.statusCode).toBe(200);
    expect(authorSaves.json<Envelope<{ signals: Signal[] }>>().data.signals.map((signal) => signal.id)).not.toContain(id);

    const echo = await request("POST", `/api/signals/${id}/echoes`, reader.cookie, { content: "Synthetic echo for visibility regression." });
    expect(echo.statusCode).toBe(201);
    const echoes = await request("GET", `/api/signals/${id}/echoes`);
    expect(echoes.statusCode).toBe(200);
    expect(echoes.json<Envelope<{ echoes: unknown[] }>>().data.echoes).toHaveLength(1);

    // A synthetic stored byte fixture exercises real media reads without TTS.
    // The harness configured this storage module's root to its owned temp dir.
    const { writeSignalAudio } = await import("../../src/modules/signals/audio-storage.js");
    const storageKey = `${id}.mp3`;
    const syntheticAudio = Buffer.from("ID3 synthetic integration audio fixture");
    await writeSignalAudio(storageKey, syntheticAudio);
    const audioUrl = `/api/signals/${id}/audio/main`;
    await h.sql`
      update signals set audio_status = 'READY', audio_storage_key = ${storageKey},
        audio_storage_key_left = ${storageKey}, audio_storage_key_right = ${storageKey},
        audio_url = ${audioUrl}, audio_url_left = ${audioUrl}, audio_url_right = ${audioUrl}
      where id = ${id}
    `;
    const audio = await request("GET", audioUrl);
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/mpeg");
    expect(audio.rawPayload).toEqual(syntheticAudio);
    await moderate(id, "HIDDEN");
    await expectNotPublic(id);
    const [retainedSave] = await h.sql<{ count: number }[]>`
      select count(*)::integer as count from signal_saves where signal_id = ${id}
    `;
    expect(retainedSave.count).toBe(1);
  });

  // C1 will add a real author-withdrawal endpoint. Administrative hiding above
  // verifies today's visibility contract and is not reported as author withdrawal.
});
