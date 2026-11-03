import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbuseControlStopped } from "../../shared/abuse-errors.js";
import { reserveAbuse } from "../../shared/abuse-control.js";
import { GenerationAdmissionDenied } from "./admission-errors.js";
import { createSignalDraft } from "./repository.js";
import { createPendingSignal } from "./service-creation.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { SignalRecord } from "./types.js";

vi.mock("../../shared/abuse-control.js", () => ({ reserveAbuse: vi.fn() }));
vi.mock("./repository.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./repository.js")>(), createSignalDraft: vi.fn(),
}));

const author: AuthenticatedFrequency = {
  id: "00000000-0000-4000-8000-000000000601", freqCode: "FM 06.01",
  createdAt: "2026-01-01T00:00:00.000Z", isGuest: false, role: "USER", status: "ACTIVE",
};
const body = { seedText: "Synthetic admission control." };
const persisted = {
  id: "00000000-0000-4000-8000-000000000602", generationStatus: "RECEIVED", status: "DRAFT",
  seedText: body.seedText, parentSignalId: null, createdAt: new Date(0), updatedAt: new Date(0),
} as SignalRecord; // Adapter supplies only the fields consumed by the accepted DTO.
const reservation = { token: "synthetic", commit: vi.fn(), refund: vi.fn() };
const worker = { accepting: true, wake: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  reservation.commit.mockResolvedValue("COMMITTED");
  reservation.refund.mockResolvedValue("REFUNDED");
  vi.mocked(reserveAbuse).mockResolvedValue(reservation);
  vi.mocked(createSignalDraft).mockResolvedValue(persisted);
});

describe("generation admission budget ownership", () => {
  it("reserves all request/day budgets before accepting a durable signal", async () => {
    const result = await createPendingSignal(author, body, undefined, worker);
    expect(result.id).toBe(persisted.id);
    expect(reserveAbuse).toHaveBeenCalledWith([
      { rule: "generationRequestUser", identity: author.id },
      { rule: "generationDailyUser", identity: author.id },
      { rule: "generationDailySite", identity: "site" },
    ]);
    expect(reservation.commit).toHaveBeenCalledTimes(1);
    expect(reservation.refund).not.toHaveBeenCalled();
    expect(worker.wake).toHaveBeenCalledTimes(1);
  });

  it("does not insert or wake after a quota denial", async () => {
    vi.mocked(reserveAbuse).mockRejectedValueOnce(new AbuseControlStopped("limited", "generationDailyUser", 500));
    await expect(createPendingSignal(author, body, undefined, worker)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(createSignalDraft).not.toHaveBeenCalled();
    expect(worker.wake).not.toHaveBeenCalled();
  });

  it("refunds its reservation only after a definitive pre-insert admission rejection", async () => {
    vi.mocked(createSignalDraft).mockRejectedValueOnce(new GenerationAdmissionDenied());
    await expect(createPendingSignal(author, body, undefined, worker)).rejects.toBeInstanceOf(GenerationAdmissionDenied);
    expect(reservation.refund).toHaveBeenCalledTimes(1);
    expect(reservation.commit).not.toHaveBeenCalled();
    expect(worker.wake).not.toHaveBeenCalled();
  });

  it("retains quota when a database commit acknowledgement is uncertain", async () => {
    vi.mocked(createSignalDraft).mockRejectedValueOnce(new Error("Synthetic lost commit acknowledgement."));
    await expect(createPendingSignal(author, body, undefined, worker)).rejects.toThrow("Synthetic lost commit");
    expect(reservation.refund).not.toHaveBeenCalled();
    expect(reservation.commit).not.toHaveBeenCalled();
    expect(worker.wake).not.toHaveBeenCalled();
  });

  it("returns the accepted ID if only the quota commit acknowledgement is lost", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    reservation.commit.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_STORAGE_DETAIL"));
    const result = await createPendingSignal(author, body, logger, worker);
    expect(result.id).toBe(persisted.id);
    expect(worker.wake).toHaveBeenCalledTimes(1);
    expect(reservation.refund).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SYNTHETIC_PRIVATE_STORAGE_DETAIL");
  });

  it("does not reserve quota when the worker is refusing new work", async () => {
    await expect(createPendingSignal(author, body, undefined, { ...worker, accepting: false }))
      .rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(reserveAbuse).not.toHaveBeenCalled();
    expect(createSignalDraft).not.toHaveBeenCalled();
  });
});
