import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { auditSignalReplicas, replicaCategories } from "./replica-audit.js";
import { confirmPublicationSnapshot, digestPublicationContent } from "./publication.js";

const io = vi.hoisted(() => ({ execute: vi.fn(), lstat: vi.fn(), realpath: vi.fn() }));
vi.mock("../../db/client.js", () => ({ db: { execute: io.execute } }));
vi.mock("node:fs/promises", () => ({ lstat: io.lstat, realpath: io.realpath }));
const id = "00000000-0000-4000-8000-000000000111";
const linkedId = "00000000-0000-4000-8000-000000000112";
const root = resolve("test-results", "synthetic-audio-root");
const secret = "SYNTHETIC_PRIVATE_REPLICA_CANARY";
const content = { expandedText: secret, tags: ["synthetic"] };
const snapshot = confirmPublicationSnapshot({ content, version: 0, digest: digestPublicationContent(content) }, new Date("2026-01-01Z"));
function row() {
  return { signal: { id, status: "PUBLISHED", generationStatus: "COMPLETED", publicationVersion: 1,
    withdrawn: false, publicationSnapshot: snapshot, hasEmbedding: true, hasProgram: true,
    audioStatus: "READY", audioPublicationVersion: 1,
    audioKeys: { main: `${id}.mp3`, left: null, right: null } },
  counts: Object.fromEntries(replicaCategories.map((category) => [category, category === "MATCH_LINK" ? "2" : "0"])),
  samples: [{ category: "MATCH_LINK", id: linkedId }], unattributedAiReviewCount: "3" };
}
beforeEach(() => {
  vi.clearAllMocks();
  io.execute.mockResolvedValue([row()]);
  io.realpath.mockImplementation(async (path: string) => path);
  io.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false });
});

describe("read-only signal replica inventory", () => {
  it("returns explicit references and media states without content, hashes, keys or paths", async () => {
    const report = await auditSignalReplicas(id, 1, { audioStorageDirectory: root });
    expect(report).toMatchObject({ signalId: id, readOnly: true, databaseSnapshot: "single-statement", sampleLimit: 1,
      signal: { publicEligible: true, hasPublicationSnapshot: true, hasEmbedding: true }, counts: { MATCH_LINK: 2 },
      samples: [{ category: "MATCH_LINK", id: linkedId }], truncated: true, unattributedAiReviewCount: 3,
      audio: [{ channel: "main", state: "PRESENT" }, { channel: "left", state: "NOT_REFERENCED" }, { channel: "right", state: "NOT_REFERENCED" }] });
    const serialized = JSON.stringify(report);
    for (const hidden of [secret, snapshot.digest, root, `${id}.mp3`, "audioKeys", "publicationSnapshot"]) expect(serialized).not.toContain(hidden);
    expect(io.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(io.execute.mock.calls[0]![0] as SQL);
    expect(query.sql).not.toMatch(/\b(insert|update|delete|truncate)\b/iu);
    expect(query.sql).toContain("execution_json->'operation'->>'signalId'");
    expect(query.sql).not.toContain("input_text");
    expect(query.params.at(-1)).toBe(1);
    expect(io.lstat).toHaveBeenCalledTimes(1);
  });
  it("reports missing signals without associating unrelated AI reviews or reading media", async () => {
    io.execute.mockResolvedValue([{ ...row(), signal: null }]);
    const report = await auditSignalReplicas(id);
    expect(report.signal).toBeNull();
    expect(report.unattributedAiReviewCount).toBe(3);
    expect(report.limitations).toContain("Unattributed AI reviews are counted globally and are not attributed to this signal; historical records are not backfilled.");
    expect(io.lstat).not.toHaveBeenCalled();
  });
  it("validates current publication state and confirmation digest before reporting public eligibility", async () => {
    const stored = row();
    stored.signal.publicationSnapshot = { ...snapshot, digest: "0".repeat(64) };
    io.execute.mockResolvedValue([stored]);
    expect((await auditSignalReplicas(id)).signal?.publicEligible).toBe(false);
    io.execute.mockResolvedValue([{ ...row(), signal: { ...row().signal, withdrawn: true } }]);
    expect((await auditSignalReplicas(id)).signal?.publicEligible).toBe(false);
  });
  it.each(["../outside.mp3", "nested/file.mp3", "C:\\outside.mp3"])("does not follow unsafe stored key %s", async (key) => {
    const stored = row(); stored.signal.audioKeys.main = key;
    io.execute.mockResolvedValue([stored]);
    expect((await auditSignalReplicas(id)).audio[0]?.state).toBe("UNSAFE");
    expect(io.lstat).not.toHaveBeenCalled();
    expect(io.realpath).not.toHaveBeenCalled();
  });
  it("distinguishes missing, symlink, escaped and unreadable files without exposing errors", async () => {
    io.lstat.mockRejectedValueOnce(Object.assign(new Error(secret), { code: "ENOENT" }));
    expect((await auditSignalReplicas(id)).audio[0]?.state).toBe("MISSING");
    io.lstat.mockResolvedValueOnce({ isFile: () => true, isSymbolicLink: () => true });
    expect((await auditSignalReplicas(id)).audio[0]?.state).toBe("UNSAFE");
    io.realpath.mockResolvedValueOnce(root).mockResolvedValueOnce(resolve(root, "..", "outside.mp3"));
    expect((await auditSignalReplicas(id, 50, { audioStorageDirectory: root })).audio[0]?.state).toBe("UNSAFE");
    io.lstat.mockRejectedValueOnce(Object.assign(new Error(secret), { code: "EACCES" }));
    const denied = await auditSignalReplicas(id);
    expect(denied.audio[0]?.state).toBe("UNVERIFIABLE");
    expect(JSON.stringify(denied)).not.toContain(secret);
  });
  it.each([0, 201, -1, 1.2, NaN, Infinity])("rejects invalid limit %s before querying", async (limit) => {
    await expect(auditSignalReplicas(id, limit)).rejects.toThrow("sample limit");
    expect(io.execute).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs, malformed rows and imprecise counts", async () => {
    await expect(auditSignalReplicas("not-a-uuid")).rejects.toThrow("UUID");
    expect(io.execute).not.toHaveBeenCalled();
    io.execute.mockResolvedValue([{ ...row(), samples: [{ category: "MATCH_LINK", id: linkedId, content: secret }] }]);
    await expect(auditSignalReplicas(id)).rejects.toThrow();
    const stored = row(); stored.counts.MATCH_LINK = "9007199254740993";
    io.execute.mockResolvedValue([stored]);
    await expect(auditSignalReplicas(id)).rejects.toThrow();
  });
});
