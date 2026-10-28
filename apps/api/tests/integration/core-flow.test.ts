import { createHmac, randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureExpansion, fixtureFingerprint, fixtureSeed } from "./fixtures.js";
import { createIntegrationHarness, recordCoreSetupPhase } from "./harness.js";
import type { ReadOwnedPublicationPreviewResult } from "../../src/modules/signals/publication-repository.js";

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
let setupWork: Promise<void> | undefined;
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
  const deadline = Date.now() + 10_000;
  while (true) {
    const [row] = await h.sql<{ generation_status: string; generation_error: string | null; attempt_count: number | null; dispatched: boolean; lease_expired: boolean }[]>`
      select generation_status, generation_error, generation_attempt_count as attempt_count,
        generation_dispatch_started_at is not null as dispatched,
        coalesce(generation_lease_until <= clock_timestamp(), false) as lease_expired
      from signals where id = ${id}
    `;
    if (row?.generation_status === "FAILED") {
      const code = /^GENERATION_[A-Z_]{1,48}$/u.test(row.generation_error ?? "") ? row.generation_error : "UNKNOWN";
      throw new Error(`Core generation failed: ${JSON.stringify({ code, attemptCount: row.attempt_count,
        dispatched: row.dispatched, leaseExpired: row.lease_expired })}`);
    }
    if (row?.generation_status === "COMPLETED") break;
    if (Date.now() >= deadline) throw new Error("Core generation did not complete within its existing 10s observation budget.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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

async function withCleanup(work: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
  const errors: unknown[] = [];
  try { await work(); } catch (error) { errors.push(error); }
  try { await cleanup(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "C1 fixture assertion and cleanup both failed.");
}

async function withSyntheticWithdrawalRows(
  work: (track: (id: string) => void) => Promise<void>,
): Promise<void> {
  const ids = new Set<string>();
  await withCleanup(() => work((id) => { ids.add(id); }), async () => {
    // These are only this case's synthetic rows. Retain their content and
    // withdrawal markers, but keep the existing random-public control isolated.
    if (ids.size !== 0) await h.sql`update signals set status = 'DRAFT' where id in ${h.sql([...ids])}`;
  });
}

async function createWithdrawalFixture(track: (id: string) => void, status: ModerationStatus = "DRAFT") {
  const [{ createSignalDraft }, { buildMinimalSignalProgram }] = await Promise.all([
    h.loadModule("repository"), h.loadModule("mappers"),
  ]);
  // Explicit synthetic unmanaged shape: no authorship confirmation is created
  // or inferred, and no public-read policy is exercised by these SQL cases.
  const signal = await createSignalDraft({
    authorId: author.id, frequencyId: author.id, rawInput: fixtureSeed, seedText: fixtureSeed,
    expandedText: fixtureExpansion.expandedText, fingerprint: fixtureFingerprint,
    galaxyPosition: { x: 0, y: 0, z: 0 }, generationStatus: "COMPLETED", status,
    program: buildMinimalSignalProgram({
      expandedText: fixtureExpansion.expandedText, fingerprint: fixtureFingerprint, rawInput: fixtureSeed,
    }),
  });
  track(signal.id);
  return signal;
}

async function waitForActualGenerationIdle(): Promise<void> {
  // Observation only: a failed budget does not cancel work or free any slot.
  // The enclosing finally releases the provider first; h.close still stops and
  // joins the actual worker if this bounded fixture observation fails.
  const deadline = Date.now() + 5_000;
  while (h.generationActiveCount !== 0 || h.provider.inFlight !== 0) {
    if (Date.now() >= deadline) throw new Error("C1 fixture generation did not actually settle within 5s after release.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function readyPublicationPreview(result: ReadOwnedPublicationPreviewResult) {
  expect(result.outcome).toBe("READY");
  if (result.outcome !== "READY") throw new Error("Synthetic publication preview was unavailable.");
  return result.preview;
}

async function publicationRowHash(id: string): Promise<string> {
  const [row] = await h.sql<{ row_hash: string }[]>`
    select md5(row_to_json(s)::text) as row_hash from signals s where id = ${id}
  `;
  if (row === undefined) throw new Error("Synthetic publication row was unavailable.");
  return row.row_hash;
}

async function expectPublicationRejection(
  id: string,
  outcome: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
  work: () => Promise<unknown>,
): Promise<void> {
  const before = await publicationRowHash(id);
  expect(await work()).toEqual({ outcome });
  expect(await publicationRowHash(id)).toBe(before);
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
    setupWork = (async () => {
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
    })();
    await setupWork;
  });

  afterAll(async () => {
    // A hook watchdog is not cancellation. Even if preparation finished late,
    // wait for the owned harness and close it instead of abandoning its work.
    await setupWork?.catch(() => undefined);
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
    const { env } = await h.loadModule("env");
    // Redis deliberately stores only an HMAC, not a recoverable code. Observe
    // the real local-delivery log without replacing service implementation,
    // randomness, Redis, or the API response; never write the code to output.
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
      const code = h.takeLocalLoginCode();
      if (code === undefined) throw new Error("Real challenge issuance did not reach its private local delivery channel.");
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
      h.takeLocalLoginCode();
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
    const { createSignalDraft } = await h.loadModule("repository");
    const { buildMinimalSignalProgram } = await h.loadModule("mappers");
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
    const { writeSignalAudio } = await h.loadModule("audioStorage");
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

  it("serializes ten same-author withdrawals into one epoch and enforces nonnegative publication versions", async () => {
    const { withdrawOwnedSignal } = await h.loadModule("publicationRepository");
    await withSyntheticWithdrawalRows(async (track) => {
      const { id } = await createWithdrawalFixture(track);
      const attempts = await Promise.allSettled(Array.from({ length: 10 }, () =>
        withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 0 })));
      for (const result of attempts) {
        expect(result.status).toBe("fulfilled");
        if (result.status === "fulfilled") {
          expect(result.value).toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
        }
      }
      const [once] = await h.sql`
        select withdrawn_at, publication_version, publication_snapshot,
          withdrawn_at <= clock_timestamp() as database_clock_bounded
        from signals where id = ${id}
      `;
      expect(once).toMatchObject({ publication_version: 1, publication_snapshot: null, database_clock_bounded: true });
      expect(once.withdrawn_at).not.toBeNull();
      expect(await withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 0 }))
        .toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
      expect(await withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 1 }))
        .toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
      const [repeated] = await h.sql`select withdrawn_at, publication_version from signals where id = ${id}`;
      expect(repeated).toEqual({ withdrawn_at: once.withdrawn_at, publication_version: 1 });
      await expect(h.sql`update signals set publication_version = -1 where id = ${id}`)
        .rejects.toMatchObject({ code: "23514", constraint_name: "signals_publication_version_check" });
      await expect(h.sql`update signals set audio_publication_version = -1 where id = ${id}`)
        .rejects.toMatchObject({ code: "23514", constraint_name: "signals_audio_publication_version_check" });
      const [retained] = await h.sql`select publication_version, audio_publication_version from signals where id = ${id}`;
      expect(retained).toEqual({ publication_version: 1, audio_publication_version: null });
    });
  });

  it("uses authoritative author ownership, uniform not-found results, and a stale-epoch fence", async () => {
    const { withdrawOwnedSignal } = await h.loadModule("publicationRepository");
    await withSyntheticWithdrawalRows(async (track) => {
      const wrongOwner = await createWithdrawalFixture(track);
      const conflictingIds = await createWithdrawalFixture(track);
      const fallbackOwner = await createWithdrawalFixture(track);
      const deleted = await createWithdrawalFixture(track, "DELETED");
      const epoch = await createWithdrawalFixture(track);
      await h.sql`update signals set frequency_id = ${reader.id} where id = ${conflictingIds.id}`;
      await h.sql`update signals set author_id = null where id = ${fallbackOwner.id}`;
      for (const input of [
        { id: wrongOwner.id, actorId: reader.id, expectedVersion: 0 },
        { id: conflictingIds.id, actorId: reader.id, expectedVersion: 0 },
        { id: deleted.id, actorId: author.id, expectedVersion: 0 },
        { id: randomUUID(), actorId: author.id, expectedVersion: 0 },
      ]) expect(await withdrawOwnedSignal(input)).toEqual({ outcome: "NOT_FOUND" });
      const unchanged = await h.sql`
        select withdrawn_at, publication_version from signals
        where id in ${h.sql([wrongOwner.id, conflictingIds.id, deleted.id])}
      `;
      expect(unchanged).toHaveLength(3);
      for (const row of unchanged) expect(row).toEqual({ withdrawn_at: null, publication_version: 0 });
      for (const id of [conflictingIds.id, fallbackOwner.id]) {
        expect(await withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 0 }))
          .toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
      }
      expect(await withdrawOwnedSignal({ id: epoch.id, actorId: author.id, expectedVersion: 0 }))
        .toEqual({ outcome: "WITHDRAWN", id: epoch.id, publicationVersion: 1 });
      // Model only a higher epoch as an explicit fixture mutation. This does
      // not execute or claim verification of any future re-publication flow.
      await h.sql`update signals set publication_version = 2, withdrawn_at = null where id = ${epoch.id}`;
      for (const expectedVersion of [0, 1]) {
        expect(await withdrawOwnedSignal({ id: epoch.id, actorId: author.id, expectedVersion }))
          .toEqual({ outcome: "CONFLICT" });
      }
      const [newEpoch] = await h.sql`select publication_version, withdrawn_at, publication_snapshot from signals where id = ${epoch.id}`;
      expect(newEpoch).toEqual({ publication_version: 2, withdrawn_at: null, publication_snapshot: null });
      expect(await withdrawOwnedSignal({ id: epoch.id, actorId: author.id, expectedVersion: 2 }))
        .toEqual({ outcome: "WITHDRAWN", id: epoch.id, publicationVersion: 3 });

      // Exercise the real PostgreSQL integer boundary without overflow/wrap.
      const exhausted = await createWithdrawalFixture(track);
      await h.sql`update signals set publication_version = 2147483647 where id = ${exhausted.id}`;
      expect(await withdrawOwnedSignal({ id: exhausted.id, actorId: author.id, expectedVersion: 2147483647 }))
        .toEqual({ outcome: "CONFLICT" });
      const [unchangedMax] = await h.sql`
        select publication_version, withdrawn_at from signals where id = ${exhausted.id}
      `;
      expect(unchangedMax).toEqual({ publication_version: 2147483647, withdrawn_at: null });
      await h.sql`update signals set withdrawn_at = clock_timestamp() where id = ${exhausted.id}`;
      expect(await withdrawOwnedSignal({ id: exhausted.id, actorId: author.id, expectedVersion: 2147483647 }))
        .toEqual({ outcome: "WITHDRAWN", id: exhausted.id, publicationVersion: 2147483647 });
    });
  });

  it("records withdrawal on hidden and reviewing rows without changing moderation, content, counts or consent", async () => {
    const { withdrawOwnedSignal } = await h.loadModule("publicationRepository");
    await withSyntheticWithdrawalRows(async (track) => {
      for (const status of ["HIDDEN", "REVIEWING"] as const) {
        const { id } = await createWithdrawalFixture(track, status);
        await h.sql`update signals set echo_count = 7, resonance_count = 11, is_kept = true where id = ${id}`;
        const readRetained = async () => (await h.sql`
          select status, raw_input, seed_text, expanded_text, fingerprint_json, program_json,
            echo_count, resonance_count, is_kept, publication_snapshot, generation_status,
            generation_attempt_count, audio_status, updated_at from signals where id = ${id}
        `)[0];
        const before = await readRetained();
        expect(before).toMatchObject({ status, publication_snapshot: null, echo_count: 7, resonance_count: 11 });
        expect(await withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 0 }))
          .toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
        expect(await readRetained()).toEqual(before);
        const [withdrawal] = await h.sql`select withdrawn_at is not null as withdrawn, publication_version from signals where id = ${id}`;
        expect(withdrawal).toEqual({ withdrawn: true, publication_version: 1 });
      }
    });
  });

  it("supersedes a real held managed generation and waits for its obsolete work to exit", async () => {
    const { withdrawOwnedSignal } = await h.loadModule("publicationRepository");
    await withSyntheticWithdrawalRows(async (track) => {
      const hold = h.provider.holdNextRequest();
      let id: string | undefined;
      let withdrawnRow: Record<string, unknown> | undefined;
      const readAttempt = async (signalId: string) => (await h.sql`
        select status, generation_status, generation_error, generation_attempt_id,
          generation_attempt_count, generation_lease_owner, generation_lease_until,
          generation_next_attempt_at, expanded_text, raw_input, seed_text, program_json,
          fingerprint_json, publication_snapshot, publication_version, withdrawn_at
        from signals where id = ${signalId}
      `)[0];
      await withCleanup(async () => {
        id = await createPending();
        track(id);
        await hold.received;
        expect(h.generationActiveCount).toBeGreaterThan(0);
        const running = await readAttempt(id);
        expect(running).toMatchObject({ status: "DRAFT", generation_status: "EXPANDING", publication_version: 0,
          generation_attempt_count: 1, publication_snapshot: null, withdrawn_at: null });
        expect(running.generation_attempt_id).not.toBeNull();
        expect(running.generation_lease_owner).not.toBeNull();
        expect(running.generation_lease_until).not.toBeNull();
        expect(await withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 0 }))
          .toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
        withdrawnRow = await readAttempt(id);
        expect(withdrawnRow).toMatchObject({ status: "DRAFT", generation_status: "FAILED",
          generation_error: "GENERATION_SUPERSEDED", generation_lease_owner: null,
          generation_lease_until: null, generation_next_attempt_at: null,
          generation_attempt_id: running.generation_attempt_id, generation_attempt_count: 1,
          expanded_text: running.expanded_text, raw_input: running.raw_input, seed_text: running.seed_text,
          program_json: running.program_json, fingerprint_json: running.fingerprint_json,
          publication_snapshot: null, publication_version: 1 });
        expect(withdrawnRow.withdrawn_at).not.toBeNull();
      }, async () => { hold.release(); await waitForActualGenerationIdle(); });
      if (id === undefined || withdrawnRow === undefined) throw new Error("C1 managed generation fixture was not initialized.");
      expect(await readAttempt(id)).toEqual(withdrawnRow);
      expect(h.generationActiveCount).toBe(0);
      expect(h.provider.inFlight).toBe(0);
    });
  });

  it("invalidates only the withdrawn pending audio token and retains a real normal ready control", async () => {
    const [{ withdrawOwnedSignal }, { createSignalAudioRepository }] = await Promise.all([
      h.loadModule("publicationRepository"), h.loadModule("audioRepository"),
    ]);
    await withSyntheticWithdrawalRows(async (track) => {
      // PUBLISHED is only the existing audio CAS precondition in these synthetic
      // fixtures. No confirmation snapshot, media file or Provider is created.
      const withdrawn = await createWithdrawalFixture(track, "PUBLISHED");
      const control = await createWithdrawalFixture(track, "PUBLISHED");
      const oldToken = randomUUID();
      const controlToken = randomUUID();
      await h.sql`update signals set audio_status = 'PENDING', audio_attempt_id = ${oldToken} where id = ${withdrawn.id}`;
      await h.sql`update signals set audio_status = 'PENDING', audio_attempt_id = ${controlToken} where id = ${control.id}`;
      const audio = createSignalAudioRepository({ statementTimeoutMs: 5_000, lockTimeoutMs: 1_000, maxConnections: 1 });
      await withCleanup(async () => {
        const oldSignal = await audio.readPublished(withdrawn.id);
        const controlSignal = await audio.readPublished(control.id);
        if (oldSignal === undefined || controlSignal === undefined) throw new Error("C1 audio fixtures were not readable by their existing CAS precondition.");
        expect(await withdrawOwnedSignal({ id: withdrawn.id, actorId: author.id, expectedVersion: 0 }))
          .toEqual({ outcome: "WITHDRAWN", id: withdrawn.id, publicationVersion: 1 });
        const oldKey = `${withdrawn.id}-${oldToken}.mp3`;
        const oldUrl = `/api/signals/${withdrawn.id}/audio/main`;
        expect(await audio.ready({ signal: oldSignal, attemptId: oldToken }, oldKey, oldUrl)).toBe(false);
        const [obsolete] = await h.sql`
          select audio_status, audio_error, audio_attempt_id, audio_storage_key, audio_url,
            publication_version, publication_snapshot from signals where id = ${withdrawn.id}
        `;
        expect(obsolete).toEqual({ audio_status: "FAILED", audio_error: "AUDIO_SUPERSEDED", audio_attempt_id: null,
          audio_storage_key: null, audio_url: null, publication_version: 1, publication_snapshot: null });
        const controlKey = `${control.id}-${controlToken}.mp3`;
        const controlUrl = `/api/signals/${control.id}/audio/main`;
        expect(await audio.ready({ signal: controlSignal, attemptId: controlToken }, controlKey, controlUrl)).toBe(true);
        const [ready] = await h.sql`
          select audio_status, audio_error, audio_attempt_id, audio_storage_key, audio_url,
            publication_version, withdrawn_at, publication_snapshot from signals where id = ${control.id}
        `;
        expect(ready).toEqual({ audio_status: "READY", audio_error: null, audio_attempt_id: controlToken,
          audio_storage_key: controlKey, audio_url: controlUrl, publication_version: 0,
          withdrawn_at: null, publication_snapshot: null });
      }, () => audio.close({ timeoutSeconds: 0 }));
    });
  });

  it("reads a whitelisted publication preview without writes and rejects invalid confirmation states unchanged", async () => {
    const repo = await h.loadModule("publicationRepository");
    await withSyntheticWithdrawalRows(async (track) => {
      const { id } = await createWithdrawalFixture(track);
      const before = await publicationRowHash(id);
      const preview = readyPublicationPreview(await repo.readOwnedPublicationPreview({ id, actorId: author.id }));
      expect(await publicationRowHash(id)).toBe(before);
      expect(Object.keys(preview).sort()).toEqual(["content", "digest", "version"]);
      expect(Object.keys(preview.content).sort()).toEqual(["authorFreqCode", "expandedText", "primaryBand", "tags"]);
      expect(preview).toMatchObject({ version: 0, content: {
        expandedText: fixtureExpansion.expandedText, authorFreqCode: author.frequencyCode,
        primaryBand: "self_mirror", tags: ["自我镜像", "练习", "停顿"],
      } });
      expect(preview.digest).toMatch(/^[a-f0-9]{64}$/u);
      const confirm = (overrides: Partial<{ actorId: string; expectedVersion: number; digest: string }> = {}) =>
        repo.confirmOwnedSignalPublication({ id, actorId: author.id, expectedVersion: 0, digest: preview.digest, ...overrides });
      const wrongDigest = `${preview.digest.slice(0, -1)}${preview.digest.endsWith("0") ? "1" : "0"}`;
      await expectPublicationRejection(id, "CONFLICT", () => confirm({ digest: wrongDigest }));
      await expectPublicationRejection(id, "CONFLICT", () => confirm({ expectedVersion: 1 }));
      await expectPublicationRejection(id, "NOT_FOUND", () => confirm({ actorId: reader.id }));
      await expectPublicationRejection(id, "NOT_FOUND", () => repo.readOwnedPublicationPreview({ id, actorId: reader.id }));
      expect(await repo.readOwnedPublicationPreview({ id: randomUUID(), actorId: author.id })).toEqual({ outcome: "NOT_FOUND" });
      for (const status of ["HIDDEN", "DELETED", "REVIEWING"] as const) {
        await h.sql`update signals set status = ${status} where id = ${id}`;
        const outcome = status === "REVIEWING" ? "CONFLICT" : "NOT_FOUND";
        await expectPublicationRejection(id, outcome, () => confirm());
        await expectPublicationRejection(id, outcome, () => repo.readOwnedPublicationPreview({ id, actorId: author.id }));
      }
      await h.sql`update signals set status = 'DRAFT', generation_status = 'EXPANDING' where id = ${id}`;
      await expectPublicationRejection(id, "CONFLICT", () => confirm());
      await h.sql`update signals set generation_status = 'COMPLETED', author_id = null where id = ${id}`;
      // Matching frequency_id is not confirmation authority for a NULL author.
      await expectPublicationRejection(id, "NOT_FOUND", () => confirm());
      await h.sql`update signals set author_id = ${author.id}, fingerprint_json = '{"primaryBand":"self_mirror","tags":[1]}'::jsonb where id = ${id}`;
      await expectPublicationRejection(id, "CONFLICT", () => confirm());
      await h.sql`update signals set fingerprint_json = ${h.sql.json(fixtureFingerprint)}, expanded_text = '   ' where id = ${id}`;
      await expectPublicationRejection(id, "CONFLICT", () => confirm());
      await h.sql`update signals set expanded_text = ${fixtureExpansion.expandedText} where id = ${id}`;
      const [account] = await h.sql<{ status: string }[]>`select status from users where id = ${author.id}`;
      if (account === undefined) throw new Error("Synthetic publication account was unavailable.");
      await withCleanup(async () => {
        for (const status of ["MUTED", "BANNED"] as const) {
          // Leave the frequency mirror/session unchanged to exercise canonical users.
          await h.sql`update users set status = ${status} where id = ${author.id}`;
          await expectPublicationRejection(id, "FORBIDDEN", () => confirm());
          await expectPublicationRejection(id, "FORBIDDEN", () => repo.readOwnedPublicationPreview({ id, actorId: author.id }));
        }
      }, async () => { await h.sql`update users set status = ${account.status} where id = ${author.id}`; });
      await h.sql`update signals set publication_version = 2147483647 where id = ${id}`;
      await expectPublicationRejection(id, "CONFLICT", () => confirm({ expectedVersion: 2147483647 }));
      await expectPublicationRejection(id, "CONFLICT", () => repo.readOwnedPublicationPreview({ id, actorId: author.id }));
    });
  });

  it("commits one concurrent confirmation epoch, preserves a current no-op, and requires explicit confirmation after withdrawal", async () => {
    const repo = await h.loadModule("publicationRepository");
    await withSyntheticWithdrawalRows(async (track) => {
      const { id } = await createWithdrawalFixture(track);
      const preview = readyPublicationPreview(await repo.readOwnedPublicationPreview({ id, actorId: author.id }));
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => repo.confirmOwnedSignalPublication({
        id, actorId: author.id, expectedVersion: preview.version, digest: preview.digest,
      })));
      const published = [];
      let conflicts = 0;
      for (const result of results) {
        expect(result.status).toBe("fulfilled");
        if (result.status !== "fulfilled") continue;
        if (result.value.outcome === "PUBLISHED") published.push(result.value);
        else { expect(result.value).toEqual({ outcome: "CONFLICT" }); conflicts += 1; }
      }
      expect(published).toHaveLength(1);
      expect(conflicts).toBe(5);
      const first = published[0];
      expect(first).toMatchObject({ outcome: "PUBLISHED", id, publicationVersion: 1,
        snapshot: { kind: "AUTHOR_CONFIRMED", digest: preview.digest, content: preview.content } });
      const [stored] = await h.sql`
        select status, publication_version, withdrawn_at, publication_snapshot,
          (publication_snapshot->>'confirmedAt')::timestamptz <= clock_timestamp() as database_clock_bounded
        from signals where id = ${id}
      `;
      expect(stored).toEqual({ status: "PUBLISHED", publication_version: 1, withdrawn_at: null,
        publication_snapshot: first.snapshot, database_clock_bounded: true });
      const beforeNoop = await publicationRowHash(id);
      expect(await repo.confirmOwnedSignalPublication({ id, actorId: author.id, expectedVersion: 1, digest: preview.digest }))
        .toEqual(first);
      expect(await publicationRowHash(id)).toBe(beforeNoop);
      expect(await repo.withdrawOwnedSignal({ id, actorId: author.id, expectedVersion: 1 }))
        .toEqual({ outcome: "WITHDRAWN", id, publicationVersion: 2 });
      const [retained] = await h.sql`select publication_snapshot, withdrawn_at is not null as withdrawn from signals where id = ${id}`;
      expect(retained).toEqual({ publication_snapshot: first.snapshot, withdrawn: true });
      await expectPublicationRejection(id, "CONFLICT", () => repo.confirmOwnedSignalPublication({
        id, actorId: author.id, expectedVersion: 1, digest: preview.digest,
      }));
      const refreshed = readyPublicationPreview(await repo.readOwnedPublicationPreview({ id, actorId: author.id }));
      expect(refreshed).toEqual({ ...preview, version: 2 });
      const republished = await repo.confirmOwnedSignalPublication({ id, actorId: author.id, expectedVersion: 2, digest: refreshed.digest });
      expect(republished).toMatchObject({ outcome: "PUBLISHED", id, publicationVersion: 3,
        snapshot: { kind: "AUTHOR_CONFIRMED", digest: refreshed.digest, content: refreshed.content } });
      await expectPublicationRejection(id, "CONFLICT", () => repo.confirmOwnedSignalPublication({
        id, actorId: author.id, expectedVersion: 2, digest: refreshed.digest,
      }));
      const [current] = await h.sql`select publication_version, withdrawn_at from signals where id = ${id}`;
      expect(current).toEqual({ publication_version: 3, withdrawn_at: null });
      // Explicit synthetic MAX epoch: a genuinely unchanged confirmation may
      // remain a no-op, while no increment or wrap is permitted.
      await h.sql`update signals set publication_version = 2147483647 where id = ${id}`;
      const maxPreview = readyPublicationPreview(await repo.readOwnedPublicationPreview({ id, actorId: author.id }));
      const beforeMaxNoop = await publicationRowHash(id);
      expect(await repo.confirmOwnedSignalPublication({ id, actorId: author.id,
        expectedVersion: maxPreview.version, digest: maxPreview.digest }))
        .toMatchObject({ outcome: "PUBLISHED", id, publicationVersion: 2147483647 });
      expect(await publicationRowHash(id)).toBe(beforeMaxNoop);
      // A version-zero snapshot is an intentionally inconsistent fixture, not
      // inherited confirmation authority; this explicit request must write v1.
      await h.sql`update signals set publication_version = 0 where id = ${id}`;
      expect(await repo.confirmOwnedSignalPublication({ id, actorId: author.id, expectedVersion: 0, digest: refreshed.digest }))
        .toMatchObject({ outcome: "PUBLISHED", id, publicationVersion: 1 });
    });
  });

  it("rejects stale digests after body, approved-label or canonical FM changes and restores the fixture account", async () => {
    const repo = await h.loadModule("publicationRepository");
    const fixtureAuthor = await register();
    const [account] = await h.sql<{ freq_code: string }[]>`select freq_code from users where id = ${fixtureAuthor.id}`;
    if (account === undefined) throw new Error("Synthetic FM account was unavailable.");
    await withCleanup(async () => {
      await withSyntheticWithdrawalRows(async (track) => {
        const { id } = await createWithdrawalFixture(track);
        await h.sql`update signals set author_id = ${fixtureAuthor.id}, frequency_id = ${fixtureAuthor.id} where id = ${id}`;
        const read = async () => readyPublicationPreview(await repo.readOwnedPublicationPreview({ id, actorId: fixtureAuthor.id }));
        let preview = await read();
        const rejectOld = async () => {
          await expectPublicationRejection(id, "CONFLICT", () => repo.confirmOwnedSignalPublication({
            id, actorId: fixtureAuthor.id, expectedVersion: 0, digest: preview.digest,
          }));
          const next = await read();
          expect(next.digest).not.toBe(preview.digest);
          preview = next;
        };
        await h.sql`update signals set expanded_text = ${`${fixtureExpansion.expandedText} 合成正文修订。`} where id = ${id}`;
        await rejectOld();
        await h.sql`update signals set fingerprint_json = jsonb_set(fingerprint_json, '{tags}', '["新的合成标签","窗边"]'::jsonb) where id = ${id}`;
        await rejectOld();
        const [unused] = await h.sql<{ freq_code: string }[]>`
          select candidate.freq_code from (
            select 'FM ' || lpad((n / 100)::text, 2, '0') || '.' || lpad((n % 100)::text, 2, '0') as freq_code
            from generate_series(0, 9999) as choices(n)
          ) candidate where not exists (select 1 from users u where u.freq_code = candidate.freq_code)
          order by candidate.freq_code limit 1
        `;
        if (unused === undefined) throw new Error("No synthetic FM candidate was available.");
        const [mirrorBefore] = await h.sql`select code from frequencies where id = ${fixtureAuthor.id}`;
        await h.sql`update users set freq_code = ${unused.freq_code} where id = ${fixtureAuthor.id}`;
        await rejectOld();
        expect(preview.content.authorFreqCode).toBe(unused.freq_code);
        expect((await h.sql`select code from frequencies where id = ${fixtureAuthor.id}`)[0]).toEqual(mirrorBefore);
        expect(await repo.confirmOwnedSignalPublication({ id, actorId: fixtureAuthor.id, expectedVersion: 0, digest: preview.digest }))
          .toMatchObject({ outcome: "PUBLISHED", id, publicationVersion: 1,
            snapshot: { content: { authorFreqCode: unused.freq_code, tags: ["自我镜像", "新的合成标签", "窗边"] } } });
      });
    }, async () => { await h.sql`update users set freq_code = ${account.freq_code} where id = ${fixtureAuthor.id}`; });
    expect((await h.sql`select freq_code from users where id = ${fixtureAuthor.id}`)[0])
      .toEqual({ freq_code: account.freq_code });
  });

  it("invalidates pending audio on a new confirmation epoch while a current no-op preserves a working token", async () => {
    const [repo, { createSignalAudioRepository }] = await Promise.all([
      h.loadModule("publicationRepository"), h.loadModule("audioRepository"),
    ]);
    await withSyntheticWithdrawalRows(async (track) => {
      const stale = await createWithdrawalFixture(track, "PUBLISHED");
      const control = await createWithdrawalFixture(track);
      const stalePreview = readyPublicationPreview(await repo.readOwnedPublicationPreview({ id: stale.id, actorId: author.id }));
      const controlPreview = readyPublicationPreview(await repo.readOwnedPublicationPreview({ id: control.id, actorId: author.id }));
      const confirmedControl = await repo.confirmOwnedSignalPublication({ id: control.id, actorId: author.id,
        expectedVersion: 0, digest: controlPreview.digest });
      expect(confirmedControl).toMatchObject({ outcome: "PUBLISHED", publicationVersion: 1 });
      const oldToken = randomUUID();
      const controlToken = randomUUID();
      const oldKey = `${stale.id}-${oldToken}.mp3`;
      const oldUrl = `/api/signals/${stale.id}/audio/main`;
      await h.sql`
        update signals set audio_status = 'PENDING', audio_error = 'AUDIO_UNAVAILABLE',
          audio_attempt_id = ${oldToken}, audio_publication_version = 0,
          audio_storage_key = ${oldKey}, audio_storage_key_left = ${oldKey}, audio_storage_key_right = ${oldKey},
          audio_url = ${oldUrl}, audio_url_left = ${oldUrl}, audio_url_right = ${oldUrl} where id = ${stale.id}
      `;
      await h.sql`update signals set audio_status = 'PENDING', audio_attempt_id = ${controlToken}, audio_publication_version = 1 where id = ${control.id}`;
      const audio = createSignalAudioRepository({ statementTimeoutMs: 5_000, lockTimeoutMs: 1_000, maxConnections: 1 });
      await withCleanup(async () => {
        const oldSignal = await audio.readPublished(stale.id);
        const controlSignal = await audio.readPublished(control.id);
        if (oldSignal === undefined || controlSignal === undefined) throw new Error("Synthetic audio confirmation fixtures were unavailable.");
        expect(await repo.confirmOwnedSignalPublication({ id: stale.id, actorId: author.id,
          expectedVersion: stalePreview.version, digest: stalePreview.digest }))
          .toMatchObject({ outcome: "PUBLISHED", id: stale.id, publicationVersion: 1 });
        const [reset] = await h.sql`
          select audio_status, audio_error, audio_attempt_id, audio_publication_version,
            audio_storage_key, audio_storage_key_left, audio_storage_key_right,
            audio_url, audio_url_left, audio_url_right from signals where id = ${stale.id}
        `;
        expect(reset).toEqual({ audio_status: "NOT_REQUESTED", audio_error: null, audio_attempt_id: null,
          audio_publication_version: null, audio_storage_key: oldKey, audio_storage_key_left: oldKey,
          audio_storage_key_right: oldKey, audio_url: oldUrl, audio_url_left: oldUrl, audio_url_right: oldUrl });
        expect(await audio.ready({ signal: oldSignal, attemptId: oldToken }, oldKey, oldUrl)).toBe(false);
        const beforeNoop = await publicationRowHash(control.id);
        expect(await repo.confirmOwnedSignalPublication({ id: control.id, actorId: author.id,
          expectedVersion: 1, digest: controlPreview.digest })).toEqual(confirmedControl);
        expect(await publicationRowHash(control.id)).toBe(beforeNoop);
        const controlKey = `${control.id}-${controlToken}.mp3`;
        expect(await audio.ready({ signal: controlSignal, attemptId: controlToken }, controlKey,
          `/api/signals/${control.id}/audio/main`)).toBe(true);
        const [ready] = await h.sql`select audio_status, audio_attempt_id, audio_publication_version from signals where id = ${control.id}`;
        expect(ready).toEqual({ audio_status: "READY", audio_attempt_id: controlToken, audio_publication_version: 1 });
      }, () => audio.close({ timeoutSeconds: 0 }));
    });
  });

  // These SQL foundations do not exercise publication/withdrawal HTTP routes
  // or claim that legacy public filters already honor snapshots or withdrawal.
});
