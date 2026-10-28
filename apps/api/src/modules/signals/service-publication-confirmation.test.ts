import { describe, expect, it, vi } from "vitest";
import { maxSignalPublicationVersion } from "@unfreq/contracts/signals";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { SignalConfirmationRepository } from "./publication-repository.js";
import { buildPublicationPreview, confirmPublicationSnapshot } from "./publication.js";
import { confirmSignalPublicationForOwner, previewSignalPublicationForOwner } from "./service-publication-confirmation.js";

vi.mock("./publication-repository.js", () => ({
  readOwnedPublicationPreview: vi.fn(),
  confirmOwnedSignalPublication: vi.fn(),
}));

const id = "00000000-0000-4000-8000-000000000101";
const frequency: AuthenticatedFrequency = {
  id: "00000000-0000-4000-8000-000000000201",
  createdAt: "2026-01-01T00:00:00.000Z",
  freqCode: "FM-00.01",
  role: "USER",
  status: "ACTIVE",
};
const preview = buildPublicationPreview({
  authorId: frequency.id,
  authorFreqCode: frequency.freqCode,
  expandedText: "The exact text the author saw.",
  generationStatus: "COMPLETED",
  primaryBand: "self_mirror",
  fingerprintJson: { primaryBand: "self_mirror", tags: ["独处"] },
}, 3);
const snapshot = confirmPublicationSnapshot(preview, new Date("2026-01-02T00:00:00Z"));
const request = { expectedVersion: preview.version, digest: preview.digest };

function repository() {
  return {
    readOwnedPublicationPreview: vi.fn<SignalConfirmationRepository["readOwnedPublicationPreview"]>()
      .mockResolvedValue({ outcome: "READY", preview }),
    confirmOwnedSignalPublication: vi.fn<SignalConfirmationRepository["confirmOwnedSignalPublication"]>()
      .mockResolvedValue({ outcome: "PUBLISHED", id, publicationVersion: 4, snapshot }),
  };
}

describe("author-confirmed publication services", () => {
  it("returns only the private server preview and passes authorship from the session", async () => {
    const repo = repository();
    expect(await previewSignalPublicationForOwner(id, frequency, repo)).toEqual(preview);
    expect(repo.readOwnedPublicationPreview).toHaveBeenCalledExactlyOnceWith({ id, actorId: frequency.id });
    expect(repo.confirmOwnedSignalPublication).not.toHaveBeenCalled();
  });

  it("binds confirmation to the supplied digest/version without accepting a client author or snapshot", async () => {
    const repo = repository();
    expect(await confirmSignalPublicationForOwner(id, frequency, request, repo))
      .toEqual({ id, publicationVersion: 4 });
    expect(repo.confirmOwnedSignalPublication).toHaveBeenCalledExactlyOnceWith({
      id, actorId: frequency.id, ...request,
    });
    expect(repo.readOwnedPublicationPreview).not.toHaveBeenCalled();
  });

  it.each([undefined, "MUTED", "BANNED"] as const)("rejects an unavailable publishing session before storage (%s)", async (status) => {
    const actor = status === undefined ? undefined : { ...frequency, status };
    const repo = repository();
    const expected = status === undefined
      ? { code: "UNAUTHORIZED", statusCode: 401 }
      : { code: "FORBIDDEN", statusCode: 403 };
    await expect(previewSignalPublicationForOwner(id, actor, repo)).rejects.toMatchObject(expected);
    await expect(confirmSignalPublicationForOwner(id, actor, request, repo)).rejects.toMatchObject(expected);
    expect(repo.readOwnedPublicationPreview).not.toHaveBeenCalled();
    expect(repo.confirmOwnedSignalPublication).not.toHaveBeenCalled();
  });

  it.each(["", "not-a-uuid"])("rejects invalid signal IDs before either repository operation (%s)", async (signalId) => {
    const repo = repository();
    await expect(previewSignalPublicationForOwner(signalId, frequency, repo))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    await expect(confirmSignalPublicationForOwner(signalId, frequency, request, repo))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(repo.readOwnedPublicationPreview).not.toHaveBeenCalled();
    expect(repo.confirmOwnedSignalPublication).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    {},
    { expectedVersion: 3 },
    { ...request, expectedVersion: -1 },
    { ...request, expectedVersion: 1.5 },
    { ...request, expectedVersion: maxSignalPublicationVersion + 1 },
    { ...request, expectedVersion: Number.NaN },
    { ...request, digest: "" },
    { ...request, digest: "a".repeat(63) },
    { ...request, digest: "A".repeat(64) },
    { ...request, digest: ` ${request.digest}` },
    { ...request, actorId: frequency.id },
    { ...request, snapshot },
    { ...request, expandedText: preview.content.expandedText },
  ])("rejects empty legacy confirmation and malformed or extra client fields (%j)", async (body) => {
    const repo = repository();
    await expect(confirmSignalPublicationForOwner(id, frequency, body, repo))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(repo.confirmOwnedSignalPublication).not.toHaveBeenCalled();
  });

  it.each([0, maxSignalPublicationVersion])("preserves valid boundary epochs for the repository decision (%i)", async (expectedVersion) => {
    const repo = repository();
    repo.confirmOwnedSignalPublication.mockResolvedValue({
      outcome: "PUBLISHED", id, publicationVersion: expectedVersion === 0 ? 1 : expectedVersion, snapshot,
    });
    await confirmSignalPublicationForOwner(id, frequency, { ...request, expectedVersion }, repo);
    expect(repo.confirmOwnedSignalPublication).toHaveBeenCalledExactlyOnceWith({
      id, actorId: frequency.id, digest: request.digest, expectedVersion,
    });
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND", 404, "Signal not found."],
    ["FORBIDDEN", "FORBIDDEN", 403, "This frequency cannot publish now."],
    ["CONFLICT", "CONFLICT", 409, "Publication preview changed or is unavailable. Refresh before publishing."],
  ] as const)("maps %s to a fixed error for preview and confirmation", async (outcome, code, statusCode, message) => {
    const repo = repository();
    repo.readOwnedPublicationPreview.mockResolvedValue({ outcome });
    repo.confirmOwnedSignalPublication.mockResolvedValue({ outcome });
    const expected = { code, statusCode, message, details: undefined };
    await expect(previewSignalPublicationForOwner(id, frequency, repo)).rejects.toMatchObject(expected);
    await expect(confirmSignalPublicationForOwner(id, frequency, request, repo)).rejects.toMatchObject(expected);
  });

  it("does not retry an uncertain confirmation or fabricate its receipt", async () => {
    const repo = repository();
    const error = new Error("Synthetic confirmation commit acknowledgement unavailable.");
    repo.confirmOwnedSignalPublication.mockRejectedValue(error);
    await expect(confirmSignalPublicationForOwner(id, frequency, request, repo)).rejects.toBe(error);
    expect(repo.confirmOwnedSignalPublication).toHaveBeenCalledTimes(1);
    expect(repo.readOwnedPublicationPreview).not.toHaveBeenCalled();
  });
});
