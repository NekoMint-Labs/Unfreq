import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { parseAbusePolicy } from "../../config/abuse.js";
import type { AbuseGuard } from "../../shared/abuse-control.js";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { isTtsProviderConfigured, synthesize } from "../ai/tts.js";
import type { SignalAudioRepository } from "./audio-repository.js";
import { buildSignalAudioStorageKey, removeSignalAudio, writeSignalAudio } from "./audio-storage.js";
import { createSignalAudioWorker, type SignalAudioWorker } from "./audio-worker.js";
import { findPublishedSignalById, markSignalAudioFailed } from "./repository.js";
import { requestSignalAudio } from "./service-audio.js";
import type { SignalRecord } from "./types.js";

const fixture = vi.hoisted(() => ({ storageDir: "" }));
vi.mock("../../config/env.js", () => ({ env: {
  get ttsStorageDir() { return fixture.storageDir; },
  signalGenerationDbStatementTimeoutMs: 50, signalGenerationDbLockTimeoutMs: 10,
  signalGenerationShutdownGraceMs: 100,
} }));
vi.mock("./audio-repository.js", () => ({ createSignalAudioRepository: vi.fn() }));
vi.mock("./repository.js", () => ({ findPublishedSignalById: vi.fn(), markSignalAudioFailed: vi.fn() }));
vi.mock("../ai/tts.js", () => ({ isTtsProviderConfigured: vi.fn(), synthesize: vi.fn() }));

const id = "00000000-0000-4000-8000-000000000101";
const attemptId = "00000000-0000-4000-8000-000000000201";
function signal(audioStatus: SignalRecord["audioStatus"] = "NOT_REQUESTED"): SignalRecord {
  return {
    id, authorFreqCode: "FM-10.01", authorId: id, frequencyId: id,
    audioStatus, audioError: null, audioStorageKey: null, audioStorageKeyLeft: null, audioStorageKeyRight: null,
    audioUrl: null, audioUrlLeft: null, audioUrlRight: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
    echoCount: 0, resonanceCount: 0, embedding: null, embeddingDimensions: null, embeddingModel: null,
    embeddingProvider: null, embeddingVersion: null, expandedText: "synthetic audio expression",
    fingerprintJson: { coreNeed: "理解", displayText: "合成", energy: 0.5, emotionTone: "平静", frequency: "FM-10.01",
      hiddenNeed: "理解", innerConflict: "合成", narrativeConflict: "合成", openness: 0.5,
      primaryBand: "relationship_nebula", primaryEmotion: "平静", resonanceKeywords: ["合成"], riskLevel: "LOW",
      secondaryEmotions: [], signalType: "synthetic", subFeeling: "need_to_be_understood", tags: ["合成"], theme: "合成", title: "合成" },
    programJson: { bridgeNarration: "合成", closingQuestion: "合成", hostIntro: "合成", leftSignalSummary: "合成",
      programTitle: "合成", rightSignalSummary: "合成", shareQuote: "合成" },
    followUpQuestion: null, galaxyPosition: null, generationError: null, generationStatus: "COMPLETED",
    guestKey: null, coreNeed: null, emotionTone: null, innerConflict: null, matchSignalId: null,
    parentSignalId: null, primaryBand: null, qualityReason: null, qualityScore: null,
    rawInput: "synthetic-private-seed", seedText: "synthetic-private-seed", resonanceKeywords: null,
    source: "human", status: "PUBLISHED", subFeeling: null, isKept: false,
  };
}
function setup(audioStatus: SignalRecord["audioStatus"] = "NOT_REQUESTED") {
  const attempt = { signal: signal("PENDING"), attemptId };
  // Repository results are protocol fixtures, not a JS implementation/proof of
  // SQL claim atomicity. Real PostgreSQL/multi-PID verification is separate.
  const repository = {
    readPublished: vi.fn<SignalAudioRepository["readPublished"]>().mockResolvedValue(signal(audioStatus)),
    claim: vi.fn<SignalAudioRepository["claim"]>().mockResolvedValue({ outcome: "CLAIMED", attempt }),
    markUnavailable: vi.fn<SignalAudioRepository["markUnavailable"]>().mockResolvedValue(signal("FAILED")),
    isOwnedPublic: vi.fn<SignalAudioRepository["isOwnedPublic"]>().mockResolvedValue(true),
    ready: vi.fn<SignalAudioRepository["ready"]>().mockResolvedValue(true),
    failed: vi.fn<SignalAudioRepository["failed"]>().mockResolvedValue(true),
    outcome: vi.fn<SignalAudioRepository["outcome"]>().mockResolvedValue("PENDING"),
    isFileReferenced: vi.fn<SignalAudioRepository["isFileReferenced"]>().mockResolvedValue(false),
    close: vi.fn<SignalAudioRepository["close"]>().mockResolvedValue(undefined),
  };
  const reservation = { token: "private-synthetic-reservation", commit: vi.fn().mockResolvedValue("COMMITTED"), refund: vi.fn().mockResolvedValue("REFUNDED") };
  const lease = { token: "private-synthetic-lease", remainingMs: 5000, assertActive: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
  const guard: AbuseGuard = {
    policy: { ...parseAbusePolicy({ mode: "test" }), ttsTaskTimeoutMs: 5000 },
    consume: vi.fn().mockResolvedValue(undefined), reserve: vi.fn().mockResolvedValue(reservation),
    acquireConcurrency: vi.fn().mockResolvedValue(lease), authorizeProviderDispatch: vi.fn().mockResolvedValue(undefined),
  };
  const configured = vi.fn().mockResolvedValue(true);
  const synth = vi.fn<typeof synthesize>().mockImplementation(async (_text, _voice, _speed, options) => {
    await options?.beforeDispatch?.();
    return Buffer.from("synthetic-audio");
  });
  const write = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const options = { repository, guard, isProviderConfigured: configured, synthesize: synth,
    writeAudio: write, removeAudio: remove, logger, statementTimeoutMs: 50, lockTimeoutMs: 10, closeTimeoutMs: 10, shutdownBudgetMs: 100 };
  return { repository, attempt, reservation, lease, guard, configured, synth, write, remove, logger, options };
}
const workers: SignalAudioWorker[] = [];
function worker(options: Parameters<typeof createSignalAudioWorker>[0]) {
  const owned = createSignalAudioWorker(options); workers.push(owned); return owned;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => {
  await Promise.allSettled(workers.splice(0).map((owned) => owned.stop()));
  if (fixture.storageDir) {
    const target = resolve(fixture.storageDir);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("unfreq-audio-unit-")) throw new Error("Unexpected test storage cleanup target.");
    await rm(target, { recursive: true, force: true }); fixture.storageDir = "";
  }
});

describe("app-owned audio execution", () => {
  it.each(["READY", "PENDING"] as const)("reads %s cache without claiming or charging", async (status) => {
    const h = setup(status); const owned = worker(h.options);
    expect(await owned.request(id, "synthetic-ip")).toMatchObject({ audioStatus: status });
    expect(h.repository.claim).not.toHaveBeenCalled();
    expect(h.configured).not.toHaveBeenCalled(); expect(h.guard.reserve).not.toHaveBeenCalled();
    expect(h.synth).not.toHaveBeenCalled();
  });

  it("a losing claimant returns the winner's cache without a new charge", async () => {
    const h = setup(); h.repository.claim.mockResolvedValue({ outcome: "CACHED", signal: signal("PENDING") });
    expect(await worker(h.options).request(id, "synthetic-ip")).toMatchObject({ audioStatus: "PENDING" });
    expect(h.guard.reserve).not.toHaveBeenCalled(); expect(h.synth).not.toHaveBeenCalled();
  });

  it("claims once, reserves both new-audio budgets and fences each dispatch before READY", async () => {
    const h = setup(); const owned = worker(h.options);
    expect(await owned.request(id, "synthetic-ip")).toMatchObject({ audioStatus: "PENDING" });
    await vi.waitFor(() => expect(h.repository.ready).toHaveBeenCalledOnce());
    await owned.stop();
    expect(h.guard.reserve).toHaveBeenCalledWith([{ rule: "audioNewIp", identity: "synthetic-ip" }, { rule: "audioNewDailySite", identity: "site" }]);
    expect(h.guard.acquireConcurrency).toHaveBeenCalledWith("tts", 1, expect.any(Number), 240);
    expect(() => createSignalAudioWorker({ ...h.options, shutdownBudgetMs: 2_147_483_647 })).toThrow("Invalid audio shutdown/lease drain budget.");
    expect(h.reservation.commit).toHaveBeenCalledOnce(); expect(h.reservation.refund).not.toHaveBeenCalled();
    expect(h.repository.ready).toHaveBeenCalledWith(h.attempt, `${id}-${attemptId}-main.mp3`, `/api/signals/${id}/audio/main`);
    expect(h.lease.release).toHaveBeenCalledOnce();
  });

  it("returns browser fallback without a claim or paid reservation when no provider exists", async () => {
    const h = setup(); h.configured.mockResolvedValue(false);
    expect(await worker(h.options).request(id, "synthetic-ip")).toMatchObject({ audioStatus: "FAILED" });
    expect(h.repository.claim).not.toHaveBeenCalled(); expect(h.guard.reserve).not.toHaveBeenCalled();
  });

  it("a known capacity rejection marks FAILED and refunds only the pending reservation", async () => {
    const h = setup(); vi.mocked(h.guard.acquireConcurrency).mockRejectedValue(new AbuseControlStopped("limited", "concurrency", 2000));
    await expect(worker(h.options).request(id, "synthetic-ip")).rejects.toMatchObject({ statusCode: 429 });
    expect(h.repository.failed).toHaveBeenCalledWith(h.attempt, "AUDIO_RATE_LIMITED");
    expect(h.reservation.refund).toHaveBeenCalledOnce(); expect(h.reservation.commit).not.toHaveBeenCalled();
    expect(h.synth).not.toHaveBeenCalled();
  });

  it("an uncertain SQL failure cannot become a 429 or trigger a guessed refund", async () => {
    const h = setup(); vi.mocked(h.guard.acquireConcurrency).mockRejectedValue(new AbuseControlStopped("limited", "concurrency", 2000));
    h.repository.failed.mockRejectedValue(new Error("synthetic unknown SQL"));
    await expect(worker(h.options).request(id, "synthetic-ip")).rejects.toMatchObject({ statusCode: 503 });
    expect(h.reservation.refund).not.toHaveBeenCalled();
  });

  it("does not refund after an unknown concurrency acquisition reply", async () => {
    const h = setup(); vi.mocked(h.guard.acquireConcurrency).mockRejectedValue(new AbuseControlStopped("unavailable", "storage"));
    await expect(worker(h.options).request(id, "synthetic-ip")).rejects.toMatchObject({ statusCode: 503 });
    expect(h.repository.failed).toHaveBeenCalledWith(h.attempt, "AUDIO_PROTECTION_UNAVAILABLE");
    expect(h.reservation.refund).not.toHaveBeenCalled(); expect(h.synth).not.toHaveBeenCalled();
  });

  it("does not refund or synthesize after an unknown quota commit", async () => {
    const h = setup(); h.reservation.commit.mockRejectedValue(new AbuseControlStopped("unavailable", "storage"));
    await expect(worker(h.options).request(id, "synthetic-ip")).rejects.toMatchObject({ statusCode: 503 });
    expect(h.reservation.refund).not.toHaveBeenCalled(); expect(h.synth).not.toHaveBeenCalled();
    expect(h.lease.release).toHaveBeenCalledOnce();
  });

  it("keeps a potentially live file after an unknown READY reply", async () => {
    const h = setup(); h.repository.ready.mockRejectedValue(new Error("SYNTHETIC_SQL_SECRET"));
    const owned = worker(h.options); await owned.request(id, "synthetic-ip");
    await vi.waitFor(() => expect(h.repository.failed).toHaveBeenCalled()); await owned.stop();
    expect(h.remove).not.toHaveBeenCalled(); expect(h.reservation.refund).not.toHaveBeenCalled();
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain("SYNTHETIC_SQL_SECRET");
  });

  it.each([false, true])("deletes an obsolete attempt file only when DB reference is %s", async (referenced) => {
    const h = setup(); h.repository.ready.mockResolvedValue(false); h.repository.failed.mockResolvedValue(false);
    h.repository.isFileReferenced.mockResolvedValue(referenced);
    const owned = worker(h.options); await owned.request(id, "synthetic-ip");
    await vi.waitFor(() => expect(h.repository.isFileReferenced).toHaveBeenCalled()); await owned.stop();
    expect(h.remove).toHaveBeenCalledTimes(referenced ? 0 : 1);
    if (!referenced) expect(h.remove).toHaveBeenCalledWith(`${id}-${attemptId}-main.mp3`);
  });

  it("checks ownership again on a later actual attempt and stops after moderation", async () => {
    const h = setup(); let dispatched = 0;
    h.synth.mockImplementation(async (_text, _voice, _speed, options) => {
      await options?.beforeDispatch?.(); dispatched++;
      h.repository.isOwnedPublic.mockResolvedValue(false);
      await options?.beforeDispatch?.(); dispatched++;
      return Buffer.from("should-not-write");
    });
    const owned = worker(h.options); await owned.request(id, "synthetic-ip");
    await vi.waitFor(() => expect(h.repository.failed).toHaveBeenCalled()); await owned.stop();
    expect(dispatched).toBe(1); expect(h.write).not.toHaveBeenCalled(); expect(h.repository.ready).not.toHaveBeenCalled();
  });

  it("stop aborts but holds the lease until the real synthesis Promise settles", async () => {
    const h = setup(); let release!: () => void;
    let entered!: () => void; const inSynthesis = new Promise<void>((resolve) => { entered = resolve; });
    h.synth.mockImplementation(async (_text, _voice, _speed, options) => {
      await options?.beforeDispatch?.();
      return new Promise<Buffer>((_resolve, reject) => {
        release = () => reject(options?.signal?.reason); entered();
      });
    });
    const owned = worker(h.options); await owned.request(id, "synthetic-ip"); await inSynthesis;
    let stopped = false; const closing = owned.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); expect(h.lease.release).not.toHaveBeenCalled();
    expect(h.synth.mock.calls[0][3]?.signal?.aborted).toBe(true);
    release(); await closing;
    expect(h.lease.release).toHaveBeenCalledOnce(); expect(h.repository.close).toHaveBeenCalledWith({ timeoutSeconds: 0 });
    await expect(owned.request(id, "synthetic-ip")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("force-closes the primary pool when an actual configuration query will not settle", async () => {
    const h = setup(); let unblock!: () => void;
    h.configured.mockImplementation(() => new Promise<boolean>((resolve) => { unblock = () => resolve(false); }));
    const forceCloseApplicationDatabase = vi.fn(async () => { unblock(); });
    const owned = worker({ ...h.options, forceCloseApplicationDatabase });
    const response = owned.request(id, "synthetic-ip").catch((error: unknown) => error);
    await vi.waitFor(() => expect(h.configured).toHaveBeenCalled()); await owned.stop();
    expect(forceCloseApplicationDatabase).toHaveBeenCalledOnce();
    expect(await response).toMatchObject({ statusCode: 503 }); expect(h.repository.claim).not.toHaveBeenCalled();
  });
});

describe("audio service compatibility boundary", () => {
  it("delegates the first id lookup to the app-owned worker rather than the primary pool", async () => {
    const request = vi.fn().mockResolvedValue({ audioStatus: "PENDING", signalId: id });
    await requestSignalAudio(id, undefined, { clientIp: "synthetic-ip", worker: { accepting: true, request, stop: vi.fn().mockResolvedValue(undefined) } });
    expect(request).toHaveBeenCalledWith(id, "synthetic-ip", undefined);
    expect(findPublishedSignalById).not.toHaveBeenCalled();
  });
  it("omitting a worker cannot start an unsupervised paid task", async () => {
    vi.mocked(findPublishedSignalById).mockResolvedValue(signal()); vi.mocked(isTtsProviderConfigured).mockResolvedValue(true);
    await expect(requestSignalAudio(id)).rejects.toMatchObject({ statusCode: 503, rule: "configuration" });
    expect(markSignalAudioFailed).not.toHaveBeenCalled();
  });
});

describe("attempt-owned audio storage", () => {
  it("cleans a real file created by this attempt when the write then rejects", async () => {
    fixture.storageDir = await mkdtemp(join(tmpdir(), "unfreq-audio-unit-"));
    const h = setup();
    const key = buildSignalAudioStorageKey(id, "main", attemptId);
    let created = false;
    const writeThenFail = vi.fn(async (...args: Parameters<typeof writeSignalAudio>) => {
      // Real filesystem ownership precedes the rejected await, just as a write
      // can create a partial file before Abort/ENOSPC rejects. Forward options
      // so a future precise onCreated ownership notification is also exercised.
      await writeSignalAudio(...args);
      created = true;
      throw new Error("SYNTHETIC_POST_CREATE_IO_FAILURE");
    });
    const removeOwned = vi.fn(removeSignalAudio);
    const owned = worker({ ...h.options, writeAudio: writeThenFail, removeAudio: removeOwned });
    await owned.request(id, "synthetic-ip");
    await vi.waitFor(() => expect(h.repository.failed).toHaveBeenCalledWith(h.attempt, "AUDIO_UNAVAILABLE"));
    await owned.stop();
    expect(created).toBe(true);
    expect(writeThenFail).toHaveBeenCalledOnce();
    expect(h.repository.ready).not.toHaveBeenCalled();
    await expect(readFile(join(fixture.storageDir, key))).rejects.toMatchObject({ code: "ENOENT" });
    expect(removeOwned).toHaveBeenCalledWith(key);
  });

  it("preserves an existing real file when exclusive creation fails with EEXIST", async () => {
    fixture.storageDir = await mkdtemp(join(tmpdir(), "unfreq-audio-unit-"));
    const h = setup();
    const key = buildSignalAudioStorageKey(id, "main", attemptId);
    const original = "synthetic-preexisting-file-must-not-delete";
    await writeSignalAudio(key, Buffer.from(original));
    const removeOwned = vi.fn(removeSignalAudio);
    const owned = worker({ ...h.options, writeAudio: writeSignalAudio, removeAudio: removeOwned });
    await owned.request(id, "synthetic-ip");
    await vi.waitFor(() => expect(h.repository.failed).toHaveBeenCalledWith(h.attempt, "AUDIO_UNAVAILABLE"));
    await owned.stop();
    expect(await readFile(join(fixture.storageDir, key), "utf8")).toBe(original);
    expect(removeOwned).not.toHaveBeenCalled();
    expect(h.repository.ready).not.toHaveBeenCalled();
  });

  it("keeps separate attempt keys, prevents overwrite and removes only the requested own file", async () => {
    fixture.storageDir = await mkdtemp(join(tmpdir(), "unfreq-audio-unit-"));
    const a = buildSignalAudioStorageKey(id, "main", attemptId);
    const b = buildSignalAudioStorageKey(id, "main", "00000000-0000-4000-8000-000000000202");
    expect(a).not.toBe(b); expect(buildSignalAudioStorageKey(id, "main")).toBe(`${id}.mp3`);
    await writeSignalAudio(a, Buffer.from("first")); await writeSignalAudio(b, Buffer.from("second"));
    await expect(writeSignalAudio(a, Buffer.from("replacement"))).rejects.toMatchObject({ code: "EEXIST" });
    await removeSignalAudio(a); await removeSignalAudio(a);
    expect(await readFile(join(fixture.storageDir, b), "utf8")).toBe("second");
    expect(() => buildSignalAudioStorageKey(id, "main", "../../foreign")).toThrow();
    await expect(removeSignalAudio("../../foreign")).rejects.toThrow();
  });
});
