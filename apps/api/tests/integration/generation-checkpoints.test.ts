import { describe, expect, it } from "vitest";
import { withGenerationHarness, type GenerationHarness, type GenerationProcess } from "./generation-harness.js";
import type { CheckpointPoint, GenerationControlState } from "./generation-test-controls.js";
import type { GenerationWorkerState } from "./generation-process-fixture.js";

const twoBootBudget = 90_000;
const completed = (row: { generation_status: string; positioned: boolean }) => row.generation_status === "COMPLETED" && row.positioned;

async function arm(child: GenerationProcess, point: CheckpointPoint) {
  return (await child.request<{ gateId: string }>({ kind: "checkpoint-arm", point })).gateId;
}
async function reached(h: GenerationHarness, child: GenerationProcess, gateId: string) {
  const state = await h.waitControl(child, (value) => value.checkpoint?.gateId === gateId && value.checkpoint.reached,
    "real-repository-checkpoint-reached");
  return state.checkpoint!;
}
async function release(child: GenerationProcess, gateId: string) {
  expect(await child.request({ kind: "checkpoint-release", gateId })).toEqual({ released: true });
}
async function finish(h: GenerationHarness, id: string) {
  const row = await h.waitRow(id, completed, "original-id-completed", 5_000);
  await h.waitIdle();
  expect(row.status).toBe("DRAFT");
  return row;
}
async function unknown(h: GenerationHarness, id: string, attemptId: string | null) {
  const row = await h.waitRow(id, (value) => value.generation_status === "FAILED", "unknown-attempt-recovered", 3_000);
  await h.waitIdle();
  expect(row).toMatchObject({ status: "DRAFT", generation_error: "GENERATION_OUTCOME_UNKNOWN",
    generation_attempt_count: 1, generation_attempt_id: attemptId, generation_lease_owner: null, generation_lease_until: null });
}

describe("real generation checkpoints and process lifecycle", () => {
  it("recovers a committed unclaimed pending after pure API death behind the real queue advisory key", async () => {
    await withGenerationHarness("preclaim", async (h) => {
      const gate = await h.holdClaims();
      const first = await h.start("unclaimed-producer");
      const author = await h.register(first);
      const id = await h.createPending(first, author);
      expect(await h.row(id)).toMatchObject({ status: "DRAFT", generation_status: "RECEIVED",
        generation_attempt_count: 0, generation_attempt_id: null, generation_lease_owner: null, generation_dispatch_started_at: null });
      expect(h.provider.tasks).toEqual([]);
      expect(await first.request<GenerationWorkerState>({ kind: "worker-state" }))
        .toEqual({ mode: "worker", accepting: true, activeCount: 0 });
      await first.hardStop("pure-kill-before-claim");
      await h.waitNoAppConnections();
      await gate.release();
      const second = await h.start("unclaimed-recovery");
      expect(second.pid).not.toBe(first.pid);
      expect(await finish(h, id)).toMatchObject({ generation_attempt_count: 1 });
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
      h.record("checkpoint-result", { point: "preclaim", faultMode: "pure-api-kill", id });
    });
  }, twoBootBudget);

  it("reclaims an undispatched real lease after pure death at the dispatch repository entry", async () => {
    await withGenerationHarness("predispatch", async (h) => {
      const first = await h.start("before-dispatch");
      const author = await h.register(first);
      const gateId = await arm(first, "before-dispatch");
      const id = await h.createPending(first, author);
      const point = await reached(h, first, gateId);
      expect(point.signalId).toBe(id);
      const before = await h.row(id);
      expect(before).toMatchObject({ generation_status: "EXPANDING", generation_attempt_count: 1,
        generation_attempt_id: point.attemptId, generation_dispatch_started_at: null });
      expect(h.provider.tasks).toEqual([]);
      await first.hardStop("pure-kill-before-dispatch-sql");
      await h.waitNoAppConnections();
      const second = await h.start("undispatched-recovery");
      expect(second.pid).not.toBe(first.pid);
      const after = await finish(h, id);
      expect(after.generation_attempt_count).toBe(2);
      expect(after.generation_attempt_id).not.toBe(before.generation_attempt_id);
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
      h.record("checkpoint-result", { point: "predispatch", faultMode: "pure-api-kill-instrumented-entry", id });
    });
  }, twoBootBudget);

  it("settles an already dispatched attempt without replay after pure death before completion SQL", async () => {
    await withGenerationHarness("prewrite", async (h) => {
      const first = await h.start("before-completion");
      const author = await h.register(first);
      const gateId = await arm(first, "before-complete");
      const id = await h.createPending(first, author);
      expect((await reached(h, first, gateId)).signalId).toBe(id);
      const before = await h.row(id);
      expect(before).toMatchObject({ generation_status: "WRITING", generation_attempt_count: 1 });
      expect(before.generation_dispatch_started_at).not.toBeNull();
      expect(h.provider.inFlight).toBe(0);
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
      await first.hardStop("pure-kill-before-completion-sql");
      await h.waitNoAppConnections();
      const second = await h.start("completion-unknown-recovery");
      expect(second.pid).not.toBe(first.pid);
      await unknown(h, id, before.generation_attempt_id);
      expect((await h.row(id)).expanded_text).toBe(before.expanded_text);
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
      const control = await h.createPending(second, author);
      await finish(h, control);
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review", "signal-material", "signal-expansion-review"]);
      h.record("checkpoint-result", { point: "prewrite", faultMode: "pure-api-kill-instrumented-entry", id });
    });
  }, twoBootBudget);

  it("bounds two real PIDs by shared C=2 while both own a live lease and scan queued work", async () => {
    await withGenerationHarness("capacity", async (h) => {
      const a = await h.start("capacity-worker-a");
      const b = await h.start("capacity-worker-b");
      const author = await h.register(a);
      const bGate = await arm(b, "before-next-claim");
      await reached(h, b, bGate);
      const holds = Array.from({ length: 6 }, () => h.provider.holdNextRequest());
      let peakHttp = 0;
      const sampler = setInterval(() => { peakHttp = Math.max(peakHttp, h.provider.inFlight); }, 5);
      try {
        const ids = [await h.createPending(a, author)];
        await h.waitHold(holds[0], a);
        const aGate = await arm(a, "before-next-claim");
        await reached(h, a, aGate);
        await release(b, bGate);
        for (let index = 1; index < 6; index++) ids.push(await h.createPending(b, author));
        await h.waitHold(holds[1], b);
        const aState = await a.request<GenerationControlState>({ kind: "control-state" });
        const bState = await b.request<GenerationControlState>({ kind: "control-state" });
        await release(a, aGate);
        await h.waitControl(a, (state) => state.claimCallsCompleted >= aState.claimCallsCompleted + 2 && state.lastClaimSize === 0,
          "worker-a-scanned-full-global-capacity");
        await h.waitControl(b, (state) => state.claimCallsCompleted >= bState.claimCallsCompleted + 2 && state.lastClaimSize === 0,
          "worker-b-scanned-full-global-capacity");
        const [leases] = await h.sql<{ count: number; owners: number }[]>`
          select count(*)::int as count, count(distinct generation_lease_owner)::int as owners from signals
          where generation_attempt_count is not null and status = 'DRAFT'
            and generation_status in ('EXPANDING','MATCHING','WRITING')
            and generation_lease_until > clock_timestamp() and generation_attempt_deadline_at > clock_timestamp()
        `;
        expect(leases).toEqual({ count: 2, owners: 2 });
        for (const child of [a, b]) expect(await child.request<GenerationWorkerState>({ kind: "worker-state" }))
          .toEqual({ mode: "worker", accepting: true, activeCount: 1 });
        expect(h.provider.tasks).toEqual(["signal-material", "signal-material"]);
        expect(h.provider.inFlight).toBe(2);
        h.provider.releaseAll();
        const settled = await Promise.allSettled(ids.map((id) => h.waitRow(id, completed, "shared-capacity-work-completed", 5_000)));
        const failures = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
        if (failures.length) throw new AggregateError(failures, "Shared capacity work did not complete.");
        await h.waitIdle();
        expect(peakHttp).toBeLessThanOrEqual(2);
        expect(h.provider.tasks.filter((task) => task === "signal-material")).toHaveLength(6);
        expect(h.provider.tasks.filter((task) => task === "signal-expansion-review")).toHaveLength(6);
        for (const id of ids) expect((await h.row(id)).generation_attempt_count).toBe(1);
        h.record("two-pid-capacity-result", { peakHttp, effectiveLeases: leases.count, owners: leases.owners });
      } finally { clearInterval(sampler); }
    });
  }, twoBootBudget);

  it("rejects the real old completion CAS after administrator HIDDEN to DRAFT ABA", async () => {
    await withGenerationHarness("aba", async (h) => {
      const child = await h.start("admin-aba-worker");
      const author = await h.register(child);
      const admin = await h.register(child, true);
      const gateId = await arm(child, "before-complete");
      const id = await h.createPending(child, author);
      const point = await reached(h, child, gateId);
      expect(point.signalId).toBe(id);
      const before = await h.row(id);
      for (const status of ["HIDDEN", "DRAFT"]) {
        expect((await h.inject(child, { method: "PATCH", url: `/api/admin/signals/${id}/status`, cookie: admin.cookie, payload: { status } })).statusCode).toBe(200);
      }
      expect(await h.row(id)).toMatchObject({ status: "DRAFT", generation_status: "FAILED", generation_error: "GENERATION_SUPERSEDED",
        generation_attempt_id: before.generation_attempt_id, generation_lease_owner: null });
      await release(child, gateId);
      await h.waitIdle();
      // Heartbeats may cancel the wait before its delegate is called. After
      // proving that real work drained, probe only the exact captured private
      // params through the real CAS, independently of that scheduling race.
      expect(await child.request({ kind: "probe-completion", id })).toEqual({ accepted: false, outcome: "OBSOLETE" });
      await h.waitControl(child, (state) => state.completions.some((value) => value.signalId === id && value.attemptId === point.attemptId && value.outcome === "OBSOLETE"),
        "real-captured-completion-cas-rejected-after-aba");
      expect((await h.row(id)).expanded_text).toBe(before.expanded_text);
      expect((await h.inject(child, { method: "POST", url: `/api/signals/${id}/publish`, cookie: author.cookie })).statusCode).toBe(409);
      expect((await h.inject(child, { method: "GET", url: `/api/signals/${id}` })).statusCode).toBe(404);
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
    });
  }, 45_000);

  it("naturally exits after app.close aborts and drains a genuinely held outbound request", async () => {
    await withGenerationHarness("close", async (h) => {
      const child = await h.start("close-held-request");
      const author = await h.register(child);
      const hold = h.provider.holdNextRequest();
      const id = await h.createPending(child, author);
      await h.waitHold(hold, child);
      // Do not release the server-side gate to make escaped work finish.
      const diagnostics = await child.shutdown();
      expect(diagnostics).toMatchObject({ blockedHttp: 0, unhandled: 0, pendingHttp: 0 });
      expect(diagnostics.abortedHttp).toBe(1);
      expect(child.child.exitCode).toBe(0);
      expect(child.child.signalCode).toBeNull();
      expect(h.journal.filter((event) => event.event === "owned-kill" && event.pid === child.pid)).toEqual([]);
      await h.waitNoAppConnections();
      expect(await h.row(id)).toMatchObject({ generation_status: "FAILED", generation_error: "GENERATION_OUTCOME_UNKNOWN", generation_attempt_count: 1 });
      expect(h.provider.tasks).toEqual(["signal-material"]);
      hold.release();
      await h.waitIdle();
      expect(h.provider.tasks).toEqual(["signal-material"]);
    });
  }, 45_000);

  it("safely requeues shutdown before dispatch and lets a fresh PID execute the original ID", async () => {
    await withGenerationHarness("closeearly", async (h) => {
      const child = await h.start("close-before-dispatch");
      const author = await h.register(child);
      const gateId = await arm(child, "before-dispatch");
      const id = await h.createPending(child, author);
      await reached(h, child, gateId);
      expect(await child.shutdown()).toMatchObject({ blockedHttp: 0, unhandled: 0, pendingHttp: 0, abortedHttp: 0 });
      expect(child.child.exitCode).toBe(0);
      await h.waitNoAppConnections();
      expect(await h.row(id)).toMatchObject({ generation_status: "RECEIVED", generation_attempt_count: 1,
        generation_attempt_id: null, generation_lease_owner: null, generation_dispatch_started_at: null });
      expect(h.provider.tasks).toEqual([]);
      const next = await h.start("close-undispatched-recovery");
      expect(next.pid).not.toBe(child.pid);
      expect(await finish(h, id)).toMatchObject({ generation_attempt_count: 2 });
      expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
    });
  }, twoBootBudget);

  it.each(["retry", "exhaust"] as const)("bounds real predispatch SQL faults and persisted backoff in %s mode", async (caseId) => {
    await withGenerationHarness(caseId, async (h) => {
      const child = await h.start("bounded-retry-worker");
      const author = await h.register(child);
      await h.installDispatchFault(author, caseId === "retry" ? "twice" : "always");
      const id = await h.createPending(child, author);
      if (caseId === "retry") {
        expect(await finish(h, id)).toMatchObject({ generation_attempt_count: 3 });
        expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
      } else {
        expect(await h.waitRow(id, (row) => row.generation_status === "FAILED", "retry-budget-exhausted", 5_000))
          .toMatchObject({ generation_error: "GENERATION_OUTCOME_UNKNOWN", generation_attempt_count: 3 });
        await h.waitIdle();
        expect(h.provider.tasks).toEqual([]);
      }
      const controls = await child.request<GenerationControlState>({ kind: "control-state" });
      expect(controls.retries.map((retry) => retry.backoffMs)).toEqual([200, 300]);
      const history = await h.retryHistory();
      const claims = history.filter((event) => event.phase === "EXPANDING");
      const queues = history.filter((event) => event.phase === "RECEIVED");
      expect(claims.map((event) => event.attempt_count)).toEqual([1, 2, 3]);
      expect(queues.map((event) => event.attempt_count)).toEqual([1, 2]);
      expect(new Set(claims.map((event) => event.attempt_id)).size).toBe(3);
      for (let index = 0; index < queues.length; index++) {
        expect(queues[index].due_ms).not.toBeNull();
        expect(claims[index + 1].started_ms).not.toBeNull();
        expect(claims[index + 1].started_ms!).toBeGreaterThanOrEqual(queues[index].due_ms!);
      }
      await h.waitControl(child, (value) => value.claimCallsCompleted >= controls.claimCallsCompleted + 2,
        "terminal-retry-job-remains-stable-across-scans");
      expect((await h.row(id)).generation_attempt_count).toBe(3);
      if (caseId === "exhaust") {
        const controlAuthor = await h.register(child);
        const control = await h.createPending(child, controlAuthor);
        await finish(h, control);
        expect(h.provider.tasks).toEqual(["signal-material", "signal-expansion-review"]);
        expect(await h.row(id)).toMatchObject({ generation_status: "FAILED", generation_attempt_count: 3 });
      }
    });
  }, 45_000);
});
