import { describe, expect, it } from "vitest";
import { withAbuseHarness, type AbuseHarness, type AbuseProcess } from "./abuse-harness.js";
import type { AbuseResponse } from "./abuse-process-fixture.js";
import { fixtureSeed } from "./fixtures.js";

const twoBootBudget = 90_000;
type Data = { frequency?: { id: string; freqCode: string }; signal?: { id: string }; delivery?: { code?: string } };
const data = (response: AbuseResponse) => (response.body as { data: Data }).data;
const limited = (response: AbuseResponse) => { expect(response.statusCode).toBe(429); expect(Number(response.retryAfter)).toBeGreaterThan(0); };
async function pair(h: AbuseHarness) {
  const a = await h.start(); const b = await h.start(); expect(a.pid).not.toBe(b.pid); return [a, b] as const;
}
async function register(h: AbuseHarness, child: AbuseProcess) {
  const password = "synthetic-b3-password";
  const response = await h.inject(child, { method: "POST", url: "/api/auth/register", payload: { password } });
  expect(response.statusCode).toBe(201); expect(response.cookie).toBeTruthy();
  return { cookie: response.cookie!, password, frequency: data(response).frequency! };
}
async function finish(h: AbuseHarness, id: string) {
  await h.wait(async () => (await h.sql`select generation_status from signals where id = ${id}`)[0]?.generation_status === "COMPLETED", "generation-completion", 5_000);
}
async function create(h: AbuseHarness, child: AbuseProcess, cookie: string) {
  return h.inject(child, { method: "POST", url: "/api/signals", cookie, payload: { seedText: fixtureSeed } });
}
async function published(h: AbuseHarness, child: AbuseProcess, cookie: string) {
  const response = await create(h, child, cookie); expect(response.statusCode).toBe(201); const id = data(response).signal!.id;
  await finish(h, id); expect((await h.inject(child, { method: "POST", url: `/api/signals/${id}/publish`, cookie })).statusCode).toBe(200); return id;
}
async function audioReady(h: AbuseHarness, id: string) {
  await h.wait(async () => (await h.sql`select audio_status from signals where id = ${id}`)[0]?.audio_status === "READY", "audio-ready", 5_000);
}

describe("real multi-process abuse controls", () => {
  it("shares registration N+1 across PIDs and ignores forged forwarding by default", async () => {
    await withAbuseHarness("register", async (h) => {
      const [a, b] = await pair(h);
      const responses = await Promise.all([a, b, a].map((child, index) => h.inject(child, { method: "POST", url: "/api/auth/register",
        forwarded: (["198.51.100.1", "198.51.100.2", "198.51.100.3"] as const)[index], payload: { password: "synthetic-password" } })));
      expect(responses.filter((value) => value.statusCode === 201)).toHaveLength(2);
      limited(responses.find((value) => value.statusCode !== 201)!);
      expect((await h.inject(b, { method: "POST", url: "/api/auth/register", remote: "127.0.0.2", payload: { password: "synthetic-password" } })).statusCode).toBe(201);
    });
  }, twoBootBudget);

  it("uses the explicit trusted CIDR while refusing forwarding from an untrusted peer", async () => {
    await withAbuseHarness("trusted", async (h) => {
      const [a, b] = await pair(h);
      const request = (child: AbuseProcess, remote: "127.0.0.1" | "127.0.0.2", forwarded: "198.51.100.1" | "198.51.100.2") =>
        h.inject(child, { method: "POST", url: "/api/auth/register", remote, forwarded, payload: { password: "synthetic-password" } });
      expect((await request(a, "127.0.0.1", "198.51.100.1")).statusCode).toBe(201);
      expect((await request(b, "127.0.0.1", "198.51.100.1")).statusCode).toBe(201);
      limited(await request(a, "127.0.0.1", "198.51.100.1"));
      expect((await request(b, "127.0.0.1", "198.51.100.2")).statusCode).toBe(201);
      expect((await request(a, "127.0.0.2", "198.51.100.1")).statusCode).toBe(201);
      expect((await request(b, "127.0.0.2", "198.51.100.2")).statusCode).toBe(201);
      limited(await request(a, "127.0.0.2", "198.51.100.1"));
    });
  }, twoBootBudget);

  it("shares normalized password failures and refunds successful attempts without an identity oracle", async () => {
    await withAbuseHarness("password", async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a);
      const login = (child: AbuseProcess, frequencyCode: string, password = author.password, remote?: "127.0.0.2") =>
        h.inject(child, { method: "POST", url: "/api/auth/frequency/login", payload: { frequencyCode, password }, ...(remote ? { remote } : {}) });
      for (const child of [a, b, a]) expect((await login(child, author.frequency.freqCode)).statusCode).toBe(200);
      const alias = author.frequency.freqCode.replace("FM ", "fm--");
      const wrong = await Promise.all([login(a, alias, "wrong-password"), login(b, author.frequency.freqCode.slice(3), "wrong-password")]);
      expect(wrong.map((value) => value.statusCode)).toEqual([401, 401]);
      limited(await login(a, author.frequency.freqCode, "wrong-password"));
      expect((await login(b, alias, author.password, "127.0.0.2")).statusCode).toBe(200);
      const unknown = author.frequency.freqCode === "FM 99.99" ? "FM 98.98" : "FM 99.99";
      const missing = await Promise.all([login(a, unknown, "wrong-password"), login(b, unknown.replace(" ", "-"), "wrong-password")]);
      expect(missing.map((value) => value.statusCode)).toEqual([401, 401]);
      expect((missing[0].body as { error: { message: string } }).error.message).toBe((wrong[0].body as { error: { message: string } }).error.message);
      limited(await login(b, unknown, "wrong-password"));
    });
  }, twoBootBudget);

  it("atomically consumes one code and caps parallel errors without extending Redis expiry", async () => {
    await withAbuseHarness("email", async (h) => {
      const [a, b] = await pair(h);
      const issue = async (email: string) => {
        const response = await h.inject(a, { method: "POST", url: "/api/auth/login", payload: { email } });
        expect(response.statusCode).toBe(200); expect(data(response).delivery?.code).toMatch(/^\d{6}$/u); return data(response).delivery!.code!;
      };
      const verify = (child: AbuseProcess, email: string, code: string) => h.inject(child, { method: "POST", url: "/api/auth/login/verify", payload: { email, code } });
      const email = "one-use@example.com"; const code = await issue(email);
      const successes = await Promise.all([a, b, a, b].map((child) => verify(child, email, code)));
      expect(successes.filter((value) => value.statusCode === 200)).toHaveLength(1);
      expect(successes.filter((value) => value.statusCode === 401)).toHaveLength(3);
      expect(Number((await h.sql`select count(*)::int as n from users where email = ${email}`)[0].n)).toBe(1);
      const other = "parallel-errors@example.com"; const second = await issue(other); const key = h.challengeKey(other);
      const before = await h.redis.pttl(key); expect(before).toBeGreaterThan(0);
      const wrong = second === "000000" ? "111111" : "000000";
      expect((await Promise.all([a, b, a].map((child) => verify(child, other, wrong)))).map((value) => value.statusCode)).toEqual([401, 401, 401]);
      const after = await h.redis.pttl(key); expect(after).toBeGreaterThan(0); expect(after).toBeLessThanOrEqual(before);
      expect(JSON.parse((await h.redis.get(key))!).attemptCount).toBe(3);
      const last = await Promise.all([verify(a, other, wrong), verify(b, other, wrong)]);
      expect(last.map((value) => value.statusCode).sort()).toEqual([401, 429]);
      limited(last.find((value) => value.statusCode === 429)!);
      expect((await verify(a, other, second)).statusCode).toBe(401); expect(await h.redis.exists(key)).toBe(0);
    });
  }, twoBootBudget);

  it.each(["disabled", "production"] as const)("does not issue or consume email codes in %s mode", async (caseId) => {
    await withAbuseHarness(caseId, async (h) => {
      const [a, b] = await pair(h);
      for (const child of [a, b]) {
        expect(await child.request({ kind: "email-service" })).toEqual({ codes: ["FORBIDDEN", "FORBIDDEN"] });
        const response = await h.inject(child, { method: "POST", url: "/api/auth/login", payload: { email: "synthetic@example.com" } });
        expect(response.statusCode).toBe(403); expect(JSON.stringify(response.body)).not.toMatch(/"code"\s*:\s*"\d{6}"/u);
      }
      expect(await h.redis.exists(h.challengeKey("synthetic@example.com"))).toBe(0);
      await register(h, a);
    });
  }, twoBootBudget);

  it("shares diagnostic IP/site limits and records no client free-text representations", async () => {
    await withAbuseHarness("diagnostic", async (h) => {
      const [a, b] = await pair(h); const marker = "SYNTHETIC_B3_DIAGNOSTIC_MARKER";
      const payload = { correlationId: marker, message: marker, name: marker, digest: marker, requestId: marker, route: `/${marker}`, source: "client-runtime" };
      const report = (child: AbuseProcess, remote?: "127.0.0.2") => h.inject(child, { method: "POST", url: "/api/frontend-diagnostics/errors", payload, ...(remote ? { remote } : {}) });
      expect((await report(a)).statusCode).toBe(202); expect((await report(b)).statusCode).toBe(202); limited(await report(a));
      expect((await report(b, "127.0.0.2")).statusCode).toBe(202); limited(await report(a, "127.0.0.2"));
      const states = await Promise.all([a, b].map((child) => child.request<{ logLeaks: boolean; diagnosticEvents: number }>({ kind: "diagnostics" })));
      expect(states.map((value) => value.logLeaks)).toEqual([false, false]); expect(states.reduce((sum, value) => sum + value.diagnosticEvents, 0)).toBe(3);
    });
  }, twoBootBudget);

  it("admits at most one pending job per author across PIDs and releases it on completion", async () => {
    await withAbuseHarness("generation", async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a); h.provider.holdChat();
      const responses = await Promise.all([create(h, a, author.cookie), create(h, b, author.cookie)]);
      expect(responses.filter((value) => value.statusCode === 201)).toHaveLength(1); limited(responses.find((value) => value.statusCode !== 201)!);
      const id = data(responses.find((value) => value.statusCode === 201)!).signal!.id;
      await h.wait(() => h.provider.counts.chat === 1, "held-chat");
      expect(Number((await h.sql`select count(*)::int as n from signals where author_id = ${author.frequency.id}`)[0].n)).toBe(1);
      h.provider.release(); await finish(h, id);
      const next = await create(h, b, author.cookie); expect(next.statusCode).toBe(201); await finish(h, data(next).signal!.id);
    });
  }, twoBootBudget);

  it("releases the pending slot on a real terminal failure without external dispatch", async () => {
    await withAbuseHarness("generationfailed", async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a);
      for (const child of [a, b]) {
        const response = await create(h, child, author.cookie); expect(response.statusCode).toBe(201); const id = data(response).signal!.id;
        await h.wait(async () => (await h.sql`select generation_status from signals where id = ${id}`)[0]?.generation_status === "FAILED", "failed-job-releases-slot");
      }
      expect(h.provider.counts.chat).toBe(0);
    });
  }, twoBootBudget);

  it.each(["request", "daily"] as const)("shares the generation %s allowance after pending work has drained", async (caseId) => {
    await withAbuseHarness(caseId, async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a);
      for (const child of [a, b]) { const response = await create(h, child, author.cookie); expect(response.statusCode).toBe(201); await finish(h, data(response).signal!.id); }
      limited(await create(h, a, author.cookie));
      const other = await register(h, b); const control = await create(h, b, other.cookie); expect(control.statusCode).toBe(201); await finish(h, data(control).signal!.id);
    });
  }, twoBootBudget);

  it.each(["chat", "embedding", "reranker", "tts"] as const)("meters real %s dispatch/retry across PIDs", async (kind) => {
    const cases = { chat: "providerchat", embedding: "providerembedding", reranker: "providerreranker", tts: "providertts" } as const;
    await withAbuseHarness(cases[kind], async (h) => {
      const [a, b] = await pair(h);
      if (kind === "chat") {
        const author = await register(h, a);
        expect(await a.request({ kind: "preparechat", cookie: author.cookie })).toEqual({ prepared: true });
      }
      if (kind !== "reranker") h.provider.failNext(kind);
      expect(await a.request({ kind: "provider", provider: kind })).toEqual({ ok: true });
      if (kind === "reranker") expect(await b.request({ kind: "provider", provider: kind })).toEqual({ ok: true });
      expect(h.provider.counts[kind]).toBe(2);
      expect(await b.request({ kind: "provider", provider: kind })).toEqual({ ok: false, limited: true });
      expect(h.provider.counts[kind]).toBe(2);
    });
  }, twoBootBudget);

  it("fails closed for every real provider when only this case's Redis proxy closes", async () => {
    await withAbuseHarness("redisfault", async (h) => {
      const [a, b] = await pair(h); await register(h, a); await register(h, b);
      expect(h.proxy.socketCount).toBeGreaterThan(0); await h.proxy.close(); expect(h.proxy.socketCount).toBe(0);
      const results = await Promise.all([a, b].flatMap((child) => (["chat", "embedding", "reranker", "tts"] as const).map((provider) => child.request({ kind: "provider", provider }))));
      expect(results).toEqual(Array.from({ length: 8 }, () => ({ ok: false, limited: true })));
      expect(h.provider.counts).toEqual({ chat: 0, embedding: 0, reranker: 0, tts: 0 });
      expect((await h.inject(a, { method: "POST", url: "/api/auth/register", payload: { password: "synthetic-password" } })).statusCode).toBe(503);
      expect(await h.redis.ping()).toBe("PONG");
    });
  }, twoBootBudget);

  it("deduplicates one signal across PIDs, preserves cached quota and bounds distinct signal TTS", async () => {
    await withAbuseHarness("audio", async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a);
      const first = await published(h, a, author.cookie); const second = await published(h, b, author.cookie);
      h.provider.holdTts();
      const request = (child: AbuseProcess, id: string) => h.inject(child, { method: "POST", url: `/api/signals/${id}/audio` });
      const same = await Promise.all([request(a, first), request(b, first)]);
      expect(same.map((value) => value.statusCode)).toEqual([200, 200]);
      await h.wait(() => h.provider.activeWs === 1, "first-owned-tts-open");
      expect(h.provider.counts.tts).toBe(1); expect(await h.budgetUsed("audioNewDailySite", "site")).toBe(1);
      expect((await request(b, first)).statusCode).toBe(200);
      expect((await h.inject(a, { method: "GET", url: `/api/signals/${first}/audio` })).statusCode).toBe(200);
      expect(await h.budgetUsed("audioNewDailySite", "site")).toBe(1);
      limited(await request(b, second)); expect(h.provider.counts.tts).toBe(1);
      expect(await h.budgetUsed("audioNewDailySite", "site")).toBe(1);
      h.provider.release(); await audioReady(h, first);
      await h.wait(async () => h.provider.activeWs === 0 && await h.leaseCount() === 0, "closed-tts-and-released-lease");
      expect((await request(a, first)).statusCode).toBe(200); expect(await h.budgetUsed("audioNewDailySite", "site")).toBe(1);
      expect((await request(b, second)).statusCode).toBe(200); await audioReady(h, second);
      expect(h.provider.counts.tts).toBe(2); expect(h.provider.peakWs).toBeLessThanOrEqual(1);
      expect(await h.budgetUsed("audioNewDailySite", "site")).toBe(2);
    });
  }, twoBootBudget);

  it("stops the real audio worker and waits for WS exit before another PID uses its lease", async () => {
    await withAbuseHarness("audiostop", async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a);
      const first = await published(h, a, author.cookie); const second = await published(h, b, author.cookie);
      h.provider.holdTts();
      expect((await h.inject(a, { method: "POST", url: `/api/signals/${first}/audio` })).statusCode).toBe(200);
      await h.wait(() => h.provider.activeWs === 1, "held-tts-before-stop");
      await a.stop(); expect(a.child.exitCode).toBe(0); expect(a.child.signalCode).toBeNull();
      await h.wait(() => h.provider.activeWs === 0, "peer-observes-native-ws-close-after-stop"); expect(await h.leaseCount()).toBe(0);
      expect((await h.sql`select audio_status from signals where id = ${first}`)[0].audio_status).toBe("FAILED");
      h.provider.release();
      expect((await h.inject(b, { method: "POST", url: `/api/signals/${second}/audio` })).statusCode).toBe(200); await audioReady(h, second);
      expect(h.provider.counts.tts).toBe(2); expect(h.provider.peakWs).toBeLessThanOrEqual(1);
    });
  }, twoBootBudget);

  it("closes in-flight owned TTS at its deadline and admits no new WS after a Redis fault", async () => {
    await withAbuseHarness("audiofault", async (h) => {
      const [a, b] = await pair(h); const author = await register(h, a);
      const first = await published(h, a, author.cookie); const second = await published(h, b, author.cookie);
      h.provider.holdTts();
      expect((await h.inject(a, { method: "POST", url: `/api/signals/${first}/audio` })).statusCode).toBe(200);
      await h.wait(() => h.provider.activeWs === 1, "held-tts-before-redis-fault"); await h.proxy.close();
      await h.wait(() => h.provider.activeWs === 0, "real-ws-closed-after-deadline");
      expect((await h.inject(b, { method: "POST", url: `/api/signals/${second}/audio` })).statusCode).toBe(503);
      expect(h.provider.counts.tts).toBe(1); expect(await h.redis.ping()).toBe("PONG");
    });
  }, twoBootBudget);
});
