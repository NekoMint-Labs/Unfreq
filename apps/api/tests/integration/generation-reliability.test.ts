import { describe, expect, it } from "vitest";
import { fixtureExpansion } from "./fixtures.js";
import { withGenerationHarness, type GenerationHarness, type GenerationProcess } from "./generation-harness.js";
import type { GenerationStageResult, GenerationWorkerState, GenerationWriteResult } from "./generation-process-fixture.js";

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

async function prepareFencedWriters(h: GenerationHarness) {
  const older = await h.start("older-real-lease-writer");
  const author = await h.register(older);
  expect(await older.request<GenerationWorkerState>({ kind: "worker-state" }))
    .toEqual({ mode: "repository", accepting: false, activeCount: 0 });
  // This is an explicit repository fixture, not an accepted HTTP generation.
  const id = await h.createManaged(older, author);
  const first = await older.request<GenerationStageResult>({ kind: "stage", id, marker: "older" });
  expect(first).toMatchObject({ id, staged: "older", phase: "WRITING", attemptCount: 1 });
  await h.waitRow(id, (row) => row.generation_status === "WRITING" &&
    row.generation_attempt_id === first.attemptId && row.generation_lease_owner === first.ownerId &&
    row.generation_attempt_count === 1 && row.generation_dispatch_started_at === null,
  "older-real-claim-staged");
  // The observer evaluates expiry with PostgreSQL clock_timestamp(). No SQL
  // changes a lease or phase and no fixed sleep stands in for expiry.
  await h.waitRow(id, (row) => row.lease_expired && row.generation_attempt_id === first.attemptId,
    "older-lease-really-expired", 3_000);
  const newer = await h.start("newer-real-lease-writer");
  expect(newer.pid).not.toBe(older.pid);
  await healthyControl(h, newer);
  expect(await newer.request<GenerationWorkerState>({ kind: "worker-state" }))
    .toEqual({ mode: "repository", accepting: false, activeCount: 0 });
  const second = await newer.request<GenerationStageResult>({ kind: "stage", id, marker: "newer" });
  expect(second).toMatchObject({ id, staged: "newer", phase: "WRITING", attemptCount: 2 });
  expect(second.attemptId).not.toBe(first.attemptId);
  expect(second.ownerId).not.toBe(first.ownerId);
  const current = await h.row(id);
  expect(current).toMatchObject({ generation_status: "WRITING", generation_attempt_count: 2,
    generation_attempt_id: second.attemptId, generation_lease_owner: second.ownerId,
    generation_dispatch_started_at: null, lease_expired: false });
  expect(h.provider.tasks).toEqual([]);
  h.record("distinct-real-lease-writers", { id, olderAttemptId: first.attemptId, newerAttemptId: second.attemptId,
    olderCount: first.attemptCount, newerCount: second.attemptCount });
  return { id, older, newer, second };
}

// These are ordinary target assertions. A fixture/bootstrap/cleanup error is
// not a business reproduction; pre-fix evidence stays frozen separately.
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
      const before = await h.waitRow(originalId, (row) => row.generation_status === "EXPANDING" &&
        row.generation_dispatch_started_at !== null, "accepted-before-crash");
      expect(before.generation_attempt_count).toBe(1);
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
      // The first request really reached the Provider. An unknown paid result
      // must converge safely, without automatically running the whole job again.
      const recovered = await h.waitRow(originalId, (row) => row.generation_status === "FAILED",
        "original-pending-recovered-after-restart", 3_000);
      expect(recovered).toMatchObject({ generation_error: "GENERATION_OUTCOME_UNKNOWN", generation_attempt_count: 1,
        generation_attempt_id: before.generation_attempt_id, generation_lease_owner: null, generation_lease_until: null });
      await h.waitIdle();
      expect(h.provider.tasks).toEqual(["signal-material"]);
      h.record("unknown-dispatch-settled-without-replay", { id: originalId, requests: h.provider.tasks.length });
      const controlStart = h.provider.tasks.length;
      const controlId = await h.createPending(restarted, author);
      await h.waitRow(controlId, completed, "new-work-after-restart-completed", 5_000);
      await h.waitIdle();

      expect(h.provider.tasks.slice(controlStart)).toEqual(["signal-material", "signal-expansion-review"]);
      expect(await h.row(originalId)).toMatchObject({ generation_status: "FAILED",
        generation_error: "GENERATION_OUTCOME_UNKNOWN", generation_attempt_count: 1 });
    });
  }, twoBootCaseTimeoutMs);

  it("bounds six independent accepted generations instead of sending all IDs into the provider together", async () => {
    await withGenerationHarness("parallel", async (h) => {
      const child = await h.start("parallel-generations");
      const author = await h.register(child);
      expect(await child.request<GenerationWorkerState>({ kind: "worker-state" }))
        .toEqual({ mode: "worker", accepting: true, activeCount: 0 });
      const ids: string[] = [];
      const holds = Array.from({ length: 6 }, () => h.provider.holdNextRequest());
      // The child enables the real production worker with synthetic C=2.
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
      hold.release();
      await h.waitRow(id, (row) => terminal(row.generation_status), "old-generation-finished-after-moderation", 5_000);
      await h.waitIdle();
      const after = await h.row(id);
      const publish = await h.inject(child, { method: "POST", url: `/api/signals/${id}/publish`, cookie: author.cookie });
      h.record("publish-after-late-completion", { id, status: after.status, responseCode: publish.statusCode });
      expect({ status: after.status, generation: after.generation_status, error: after.generation_error,
        owner: after.generation_lease_owner, publishCode: publish.statusCode })
        .toEqual({ status, generation: "FAILED", error: "GENERATION_SUPERSEDED", owner: null, publishCode: 404 });
      expect(h.provider.tasks).toEqual(["signal-material"]);
    });
  }, 45_000);

  it("rejects an older real repository completion after a newer writer has committed its result", async () => {
    await withGenerationHarness("stale", async (h) => {
      const { id, older, newer, second } = await prepareFencedWriters(h);
      expect(await newer.request<GenerationWriteResult>({ kind: "complete", marker: "newer" }))
        .toEqual({ accepted: true, outcome: "APPLIED" });
      expect((await h.row(id)).expanded_text).toBe(newerText);
      h.record("writer-committed", { id, writer: "newer" });
      const late = await older.request<GenerationWriteResult>({ kind: "complete", marker: "older" });
      const after = await h.row(id);
      h.record("older-completion-observed", { id, accepted: late.accepted, generationStatus: after.generation_status });
      expect(late.outcome).toBe("OBSOLETE");
      expect(after).toMatchObject({ generation_status: "COMPLETED", generation_attempt_count: 2,
        generation_attempt_id: second.attemptId, generation_lease_owner: null, generation_lease_until: null });
      expect(h.provider.tasks).toEqual([]);
      expect({ accepted: late.accepted, expandedText: after.expanded_text }).toEqual({ accepted: false, expandedText: newerText });
    });
  }, twoBootCaseTimeoutMs);

  it("rejects an older real FAILED write after a newer writer has completed", async () => {
    await withGenerationHarness("failure", async (h) => {
      const { id, older, newer, second } = await prepareFencedWriters(h);
      expect(await newer.request<GenerationWriteResult>({ kind: "complete", marker: "newer" }))
        .toEqual({ accepted: true, outcome: "APPLIED" });
      expect((await h.row(id)).generation_status).toBe("COMPLETED");
      const late = await older.request<GenerationWriteResult>({ kind: "fail", marker: "older" });
      expect(late).toEqual({ accepted: false, outcome: "OBSOLETE" });
      const after = await h.row(id);
      h.record("older-failure-observed", { id, generationStatus: after.generation_status, errorPresent: after.generation_error !== null });
      expect(after).toMatchObject({ generation_attempt_count: 2, generation_attempt_id: second.attemptId,
        generation_lease_owner: null, generation_lease_until: null });
      expect(h.provider.tasks).toEqual([]);
      expect({ status: after.generation_status, error: after.generation_error, expandedText: after.expanded_text })
        .toEqual({ status: "COMPLETED", error: null, expandedText: newerText });
    });
  }, twoBootCaseTimeoutMs);
});
