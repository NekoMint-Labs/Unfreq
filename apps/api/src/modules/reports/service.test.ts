import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedFrequency } from "../auth/types.js";
import { createReport } from "./service.js";
import { createReportRecord } from "./repository.js";

const record = vi.hoisted(() => ({
  id: "00000000-0000-4000-8000-000000000801",
  targetId: "00000000-0000-4000-8000-000000000802", targetType: "SIGNAL" as const,
  createdAt: new Date("2026-10-30T00:00:00Z"), updatedAt: new Date("2026-10-30T00:00:00Z"),
  status: "PENDING" as const, reason: "涉及隐私", note: "SYNTHETIC_REVIEW_NOTE",
  reporterId: "00000000-0000-4000-8000-000000000803", reporterFreqCode: "FM 10.03",
  resolvedAt: null, resolvedById: null, resolution: null,
}));
vi.mock("./repository.js", () => ({
  createReportRecord: vi.fn(async () => record), listReportRecords: vi.fn(), updateReportRecord: vi.fn(),
  findOwnedReportRecord: vi.fn(),
}));
const frequency: AuthenticatedFrequency = { id: record.reporterId, freqCode: record.reporterFreqCode,
  role: "USER", status: "ACTIVE", createdAt: record.createdAt.toISOString() };
const body = { targetId: record.targetId, targetType: "SIGNAL" as const, reason: record.reason, note: record.note };
beforeEach(() => vi.clearAllMocks());

describe("report submission boundary", () => {
  it("returns only a status receipt, without reporter identity or review text", async () => {
    expect(await createReport(frequency, body)).toEqual({
      id: record.id, targetId: record.targetId, targetType: "SIGNAL", status: "PENDING",
      createdAt: record.createdAt.toISOString(),
    });
  });
  it("rejects account targets that have no public reader surface", async () => {
    await expect(createReport(frequency, { ...body, targetType: "USER" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createReportRecord).not.toHaveBeenCalled();
  });
  it("rejects a muted reporter before writing any review text", async () => {
    await expect(createReport({ ...frequency, status: "MUTED" }, body)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createReportRecord).not.toHaveBeenCalled();
  });
});
