import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { auditIdentityMirrors } from "./identity-audit.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db/client.js", () => ({ db: { execute } }));
const counts = { users: "3", frequencies: "3", matching: "0", missingMirror: "1", orphanMirror: "1", fieldMismatch: "2" };
const difference = { id: "00000000-0000-4000-8000-000000000111", kind: "FIELD_MISMATCH", fields: ["passwordHash", "createdAt"] };
beforeEach(() => { execute.mockReset(); });

describe("read-only identity mirror audit", () => {
  it("returns safe IDs and field names with full counts and an explicit sample bound", async () => {
    execute.mockResolvedValue([{ counts, differences: [difference] }]);
    const report = await auditIdentityMirrors(1);
    expect(report).toMatchObject({ authority: "users", readOnly: true, sampleLimit: 1, truncated: true,
      counts: { users: 3, frequencies: 3, missingMirror: 1, orphanMirror: 1, fieldMismatch: 2 }, differences: [difference] });
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(query.params).toEqual([1]);
    expect(query.sql).toMatch(/full outer join/u);
    expect(query.sql).toContain("u.created_at is distinct from f.created_at");
    expect(query.sql).not.toMatch(/\b(insert|update|delete|truncate)\b|date_trunc/u);
    expect(query.sql).not.toMatch(/u\.email|device_hash|last_seen_at/u);
  });
  it("handles an empty database without inventing an inconsistency", async () => {
    execute.mockResolvedValue([{ counts: { users: "0", frequencies: "0", matching: "0", missingMirror: "0", orphanMirror: "0", fieldMismatch: "0" }, differences: [] }]);
    expect(await auditIdentityMirrors()).toMatchObject({ counts: { users: 0, frequencies: 0 }, differences: [], truncated: false });
  });
  it.each([0, 201, -1, 1.2, NaN, Infinity])("refuses invalid sample size %s before querying", async (limit) => {
    await expect(auditIdentityMirrors(limit)).rejects.toThrow("sample limit");
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects leaked field values or unsafe identifiers from a malformed driver result", async () => {
    execute.mockResolvedValue([{ counts, differences: [{ ...difference, passwordHash: "SYNTHETIC_SECRET_CANARY" }] }]);
    await expect(auditIdentityMirrors()).rejects.toThrow();
    execute.mockResolvedValue([{ counts, differences: [{ ...difference, id: "not-a-uuid" }] }]);
    await expect(auditIdentityMirrors()).rejects.toThrow();
  });
  it("rejects an unsafe count instead of rounding it", async () => {
    execute.mockResolvedValue([{ counts: { ...counts, users: "9007199254740993" }, differences: [] }]);
    await expect(auditIdentityMirrors()).rejects.toThrow();
  });
});
