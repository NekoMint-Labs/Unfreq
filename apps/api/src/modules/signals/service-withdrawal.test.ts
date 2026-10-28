import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { SignalPublicationRepository, WithdrawOwnedSignalResult } from "./publication-repository.js";
import { withdrawSignalForOwner } from "./service-withdrawal.js";

vi.mock("./publication-repository.js", () => ({ withdrawOwnedSignal: vi.fn() }));

const id = "00000000-0000-4000-8000-000000000101";
const frequency: AuthenticatedFrequency = {
  id: "00000000-0000-4000-8000-000000000201",
  createdAt: "2026-01-01T00:00:00.000Z",
  freqCode: "FM-00.01",
  role: "USER",
  status: "ACTIVE",
};

function repository(result: WithdrawOwnedSignalResult = {
  outcome: "WITHDRAWN", id, publicationVersion: 4,
}) {
  return { withdrawOwnedSignal: vi.fn<SignalPublicationRepository["withdrawOwnedSignal"]>()
    .mockResolvedValue(result) };
}

describe("withdrawSignalForOwner", () => {
  it("requires a session before consulting storage", async () => {
    const repo = repository();
    await expect(withdrawSignalForOwner(id, undefined, 3, repo))
      .rejects.toMatchObject({ code: "UNAUTHORIZED", statusCode: 401 });
    expect(repo.withdrawOwnedSignal).not.toHaveBeenCalled();
  });

  it("rejects banned accounts without consulting storage", async () => {
    const repo = repository();
    await expect(withdrawSignalForOwner(id, { ...frequency, status: "BANNED" }, 3, repo))
      .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repo.withdrawOwnedSignal).not.toHaveBeenCalled();
  });

  it.each(["ACTIVE", "MUTED"] as const)("allows %s authors and forwards only their actor ID", async (status) => {
    const repo = repository();
    await expect(withdrawSignalForOwner(id, { ...frequency, status }, 3, repo)).resolves.toEqual({
      withdrawal: { id, withdrawn: true, publicationVersion: 4 },
    });
    expect(repo.withdrawOwnedSignal).toHaveBeenCalledExactlyOnceWith({ id, actorId: frequency.id, expectedVersion: 3 });
  });

  it.each([
    ["not-a-uuid", 3],
    [id, -1],
    [id, 0.5],
    [id, Number.NaN],
    [id, Number.POSITIVE_INFINITY],
    [id, 2_147_483_648],
  ])("rejects invalid UUID/version before storage (%s, %s)", async (signalId, version) => {
    const repo = repository();
    await expect(withdrawSignalForOwner(signalId as string, frequency, version as number, repo))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(repo.withdrawOwnedSignal).not.toHaveBeenCalled();
  });

  it("accepts initial publication version zero", async () => {
    const repo = repository({ outcome: "WITHDRAWN", id, publicationVersion: 1 });
    await expect(withdrawSignalForOwner(id, frequency, 0, repo)).resolves.toEqual({
      withdrawal: { id, withdrawn: true, publicationVersion: 1 },
    });
  });

  it("preserves the repository's idempotent version without incrementing it locally", async () => {
    const repo = repository({ outcome: "WITHDRAWN", id, publicationVersion: 4 });
    await expect(withdrawSignalForOwner(id, frequency, 3, repo)).resolves.toEqual({
      withdrawal: { id, withdrawn: true, publicationVersion: 4 },
    });
    await expect(withdrawSignalForOwner(id, frequency, 4, repo)).resolves.toEqual({
      withdrawal: { id, withdrawn: true, publicationVersion: 4 },
    });
    expect(repo.withdrawOwnedSignal).toHaveBeenCalledTimes(2);
  });

  it.each(["USER", "ADMIN"] as const)("maps unavailable ownership uniformly for %s", async (role) => {
    const repo = repository({ outcome: "NOT_FOUND" });
    await expect(withdrawSignalForOwner(id, { ...frequency, role }, 3, repo))
      .rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404, message: "Signal not found.", details: undefined });
    expect(repo.withdrawOwnedSignal).toHaveBeenCalledTimes(1);
  });

  it("maps stale publication versions to a fixed conflict", async () => {
    const repo = repository({ outcome: "CONFLICT" });
    await expect(withdrawSignalForOwner(id, frequency, 3, repo)).rejects.toMatchObject({
      code: "CONFLICT", statusCode: 409,
      message: "Signal publication changed. Refresh before withdrawing.",
    });
  });

  it("propagates an uncertain commit without retrying or fabricating success", async () => {
    const repo = repository();
    const failure = new Error("Synthetic commit acknowledgement unavailable.");
    repo.withdrawOwnedSignal.mockRejectedValue(failure);
    await expect(withdrawSignalForOwner(id, frequency, 3, repo)).rejects.toBe(failure);
    expect(repo.withdrawOwnedSignal).toHaveBeenCalledTimes(1);
  });
});
