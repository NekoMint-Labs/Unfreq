import { maxSignalPublicationVersion, type PublishSignalRequest, type SignalPublicationPreview } from "@unfreq/contracts/signals";
import { z } from "zod";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import {
  confirmOwnedSignalPublication,
  readOwnedPublicationPreview,
  type SignalConfirmationRepository,
} from "./publication-repository.js";

const signalIdSchema = z.uuid();
const publicationRequestSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative().max(maxSignalPublicationVersion),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
}) satisfies z.ZodType<PublishSignalRequest>;

function requirePublishingFrequency(frequency: AuthenticatedFrequency | undefined): AuthenticatedFrequency {
  if (frequency === undefined) throw new AppError("UNAUTHORIZED", "Frequency login required.");
  if (frequency.status !== "ACTIVE") throw new AppError("FORBIDDEN", "This frequency cannot publish now.");
  return frequency;
}

function publicationFailure(outcome: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN"): AppError {
  if (outcome === "NOT_FOUND") return new AppError("NOT_FOUND", "Signal not found.");
  if (outcome === "FORBIDDEN") return new AppError("FORBIDDEN", "This frequency cannot publish now.");
  return new AppError("CONFLICT", "Publication preview changed or is unavailable. Refresh before publishing.");
}

/** Private preview only; the caller must actually show every field before confirmation. */
export async function previewSignalPublicationForOwner(
  id: string,
  frequency: AuthenticatedFrequency | undefined,
  repository: Pick<SignalConfirmationRepository, "readOwnedPublicationPreview"> = { readOwnedPublicationPreview },
): Promise<SignalPublicationPreview> {
  const author = requirePublishingFrequency(frequency);
  if (!signalIdSchema.safeParse(id).success) throw new AppError("VALIDATION_ERROR", "Invalid publication request.");
  const result = await repository.readOwnedPublicationPreview({ id, actorId: author.id });
  if (result.outcome !== "READY") throw publicationFailure(result.outcome);
  return result.preview;
}

/** Internal command result. Existing HTTP/owner DTOs are not switched by this foundation. */
export async function confirmSignalPublicationForOwner(
  id: string,
  frequency: AuthenticatedFrequency | undefined,
  request: unknown,
  repository: Pick<SignalConfirmationRepository, "confirmOwnedSignalPublication"> = { confirmOwnedSignalPublication },
): Promise<{ id: string; publicationVersion: number }> {
  const author = requirePublishingFrequency(frequency);
  const parsed = publicationRequestSchema.safeParse(request);
  if (!signalIdSchema.safeParse(id).success || !parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid publication request.");
  }
  // Authorship comes only from the session. Do not retry an uncertain commit.
  const result = await repository.confirmOwnedSignalPublication({ id, actorId: author.id, ...parsed.data });
  if (result.outcome !== "PUBLISHED") throw publicationFailure(result.outcome);
  return { id: result.id, publicationVersion: result.publicationVersion };
}
