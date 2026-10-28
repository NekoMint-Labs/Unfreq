import { describe, expect, it } from "vitest";
import { fixtureExpansion } from "./fixtures.js";
import { withGenerationHarness, type GenerationHarness, type GenerationProcess } from "./generation-harness.js";

const terminal = (status: string) => status === "COMPLETED" || status === "FAILED";
const completed = (row: { generation_status: string; positioned: boolean }) => row.generation_status === "COMPLETED" && row.positioned;
const newerText = `${fixtureExpansion.expandedText}\n[synthetic-newer]`;
// Two real cold boots can now consume 2 * 20s, plus owned DB setup, route/IPC
// checks and teardown. Only the outer fixture watchdog gets this headroom;
// recovery remains 3s, provider gates 3s and post-release completion 5s.
const twoBootCaseTimeoutMs = 90_000;

async function healthyControl(h: GenerationHarness, child: GenerationProcess) {
  const health = await h.inject(child, { method: "GET", url: "/health" });
  expect(health.statusCode).toBe(200);
}

// These are ordinary target assertions, deliberately red on the pre-B1/B2
// implementation. A fixture/bootstrap/cleanup error is not a reproduction.
// Each case owns a separate database and real Node process; no existing A2
// application's drain/rebuild is used as a substitute for a process restart.
describe("durable pending generation and late-write invariants", () => {
  it("settles an accepted pending signal after its owned API process dies and a fresh PID starts on the same database", async () => {
    await withGenerationHarness("restart", async (h) => {
      const first = await h.start("before-crash");
      const author = await h.register(first);
      const hold = h.provider.holdNextRequest();
      const originalId = await h.createPending(first, author);
      await h.waitHold(hold, first);
      await h.waitRow(originalId, (row) => row.generation_status === "EXPANDING", "accepted-before-crash");
      expect(h.provider.tasks).toEqual(["signal-material"]);
      expect(await first.request({ kind: "diagnostics" })).toEqual({ blockedHttp: 0, unhandled: 0 });
      await first.hardStop("fault-injection-after-provider-received");
      hold.release();
      await h.waitIdle();

      const restarted = await h.start("after-crash");
      expect(restarted.pid).not.toBe(first.pid);
      await healthyControl(h, restarted);
      // Reuse the original cookie. The same database and synthetic session
      // secret are retained; a new login cannot hide an invalid restart setup.
      const original = await h.inject(restarted, { method: "GET", url: `/api/signals/${originalId}`, cookie: author.cookie });
      expect(original.statusCode).toBe(200);
      const controlId = await h.createPending(restarted, author);
      await h.waitRow(controlId, completed, "new-work-after-restart-completed", 5_000);
      await h.waitIdle();

      // A finite window is evidence of no recovery within this test budget,
      // not a measurement of an infinite wait or of a production recovery SLA.
      await h.waitRow(originalId, (row) => terminal(row.generation_status), "original-pending-recovered-after-restart", 3_000);
    });
  }, twoBootCaseTimeoutMs);

  it("bounds six independent accepted generations instead of sending all IDs into the provider together", async () => {
    await withGenerationHarness("parallel", async (h) => {
      const child = await h.start("parallel-generations");
      const author = await h.register(child);
      const ids: string[] = [];
      const holds = Array.from({ length: 6 }, () => h.provider.holdNextRequest());
      // Two is the explicit small test target. There is no existing worker
      // concurrency setting to pretend to configure on the pre-fix baseline.
      // Wire the real setting here when B1 adds that contract.
      const targetConcurrency = 2;
      let peak = 0;
      const observe = () => { peak = Math.max(peak, h.provider.inFlight); };
      const sampler = setInterval(observe, 5);
      try {
        for (let index = 0; index < holds.length; index += 1) {
          ids.push(await h.createPending(child, author));
          observe();
        }
        expect(new Set(ids).size).toBe(6);
        await h.waitHold(holds[0], child);
        await h.waitHold(holds[1], child);
        // Keep the first two slots occupied while every POST is already
        // accepted. No provider response is released during this observation.
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        observe();
        h.record("held-concurrency-sample", {
          submitted: ids.length, peakInFlight: peak, currentInFlight: h.provider.inFlight,
          materialRequests: h.provider.tasks.filter((task) => task === "signal-material").length,
        });
        h.provider.releaseAll();
        for (const id of ids) await h.waitRow(id, completed, "parallel-work-completed-after-release", 5_000);
        await h.waitIdle();
      } finally { clearInterval(sampler); }
      // Completion after releasing the gates prevents a dead worker from
      // falsely passing a concurrency-only assertion. The finite sample is
      // not a claim about an infinite bound, real load or actual billing.
      expect(peak).toBeLessThanOrEqual(targetConcurrency);
    });
  }, 45_000);

  it.each(["HIDDEN", "DELETED"] as const)("preserves an administrator's committed %s while an older provider result finishes", async (status) => {
    await withGenerationHarness(status === "HIDDEN" ? "hidden" : "deleted", async (h) => {
      const child = await h.start("moderated-generation");
      const author = await h.register(child);
      const admin = await h.register(child, true);
      const hold = h.provider.holdNextRequest();
      const id = await h.createPending(child, author);
      await h.waitHold(hold, child);
      await h.waitRow(id, (row) => row.generation_status === "EXPANDING", "provider-held-before-moderation");
      const moderation = await h.inject(child, {
        method: "PATCH", url: `/api/admin/signals/${id}/status`, cookie: admin.cookie, payload: { status },
      });
      expect(moderation.statusCode).toBe(200);
      expect((await h.row(id)).status).toBe(status);
      h.record("admin-status-committed", { id, status });
      const anonymous = await h.inject(child, { method: "GET", url: `/api/signals/${id}` });
      expect(anonymous.statusCode).toBe(404);
      // HIDDEN + unfinished currently has a separate owner progress response;
      // do not mistake that existing priority for a completed public result.
      hold.release();
      const after = await h.waitRow(id, (row) => terminal(row.generation_status), "old-generation-finished-after-moderation", 5_000);
      await h.waitIdle();
      const publish = await h.inject(child, { method: "POST", url: `/api/signals/${id}/publish`, cookie: author.cookie });
      h.record("publish-after-late-completion", { id, status: after.status, responseCode: publish.statusCode });
      // The low-risk baseline resets this to DRAFT, not automatically
      // PUBLISHED. The publishCode field separately checks the publish bypass.
      expect({ status: after.status, publishCode: publish.statusCode }).toEqual({ status, publishCode: 404 });
    });
  }, 45_000);

  it("rejects an older real repository completion after a newer writer has committed its result", async () => {
    await withGenerationHarness("stale", async (h) => {
      const older = await h.start("older-repository-writer");
      const author = await h.register(older);
      const id = await h.createPending(older, author);
      await h.waitRow(id, completed, "seed-result-completed", 5_000);
      await h.waitIdle();
      await older.request({ kind: "stage", id, marker: "older" });
      h.record("writer-input-staged", { id, writer: "older" });
      const newer = await h.start("newer-repository-writer");
      await newer.request({ kind: "stage", id, marker: "newer" });
      expect(await newer.request({ kind: "complete", marker: "newer" })).toEqual({ accepted: true });
      expect((await h.row(id)).expanded_text).toBe(newerText);
      h.record("writer-committed", { id, writer: "newer" });
      const late = await older.request<{ accepted: boolean }>({ kind: "complete", marker: "older" });
      const after = await h.row(id);
      h.record("older-completion-observed", { id, accepted: late.accepted, generationStatus: after.generation_status });
      // No lease/attempt API exists yet. This invokes the two existing real
      // repository writers in a deterministic order; it is not a fabricated
      // claim/lease test. Replace staged inputs with real attempt tokens once
      // B1/B2 defines those contracts and keep the same out-of-order invariant.
      expect({ accepted: late.accepted, expandedText: after.expanded_text }).toEqual({ accepted: false, expandedText: newerText });
    });
  }, twoBootCaseTimeoutMs);

  it("rejects an older real FAILED write after a newer writer has completed", async () => {
    await withGenerationHarness("failure", async (h) => {
      const older = await h.start("older-failure-writer");
      const author = await h.register(older);
      const id = await h.createPending(older, author);
      await h.waitRow(id, completed, "seed-result-before-failure-race", 5_000);
      await h.waitIdle();
      await older.request({ kind: "stage", id, marker: "older" });
      const newer = await h.start("newer-completed-writer");
      await newer.request({ kind: "stage", id, marker: "newer" });
      expect(await newer.request({ kind: "complete", marker: "newer" })).toEqual({ accepted: true });
      expect((await h.row(id)).generation_status).toBe("COMPLETED");
      await older.request({ kind: "progress", id, status: "FAILED" });
      const after = await h.row(id);
      h.record("older-failure-observed", { id, generationStatus: after.generation_status, errorPresent: after.generation_error !== null });
      // Body preservation alone would miss the regression: the old failure
      // currently changes the terminal status even though newer text remains.
      // Keep these as one hard assertion: a soft-only failure would be held
      // by Vitest while the coordinator incorrectly recorded workFailed=false.
      expect({ status: after.generation_status, error: after.generation_error, expandedText: after.expanded_text })
        .toEqual({ status: "COMPLETED", error: null, expandedText: newerText });
    });
  }, twoBootCaseTimeoutMs);
});
