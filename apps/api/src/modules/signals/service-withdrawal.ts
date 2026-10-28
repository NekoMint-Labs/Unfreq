import type { WithdrawSignalResponse } from "@unfreq/contracts/signals";
import { maxSignalPublicationVersion } from "@unfreq/contracts/signals";
import { z } from "zod";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import { withdrawOwnedSignal, type SignalPublicationRepository } from "./publication-repository.js";

const withdrawalInputSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative().max(maxSignalPublicationVersion),
});

export async function withdrawSignalForOwner(
  id: string,
  frequency: AuthenticatedFrequency | undefined,
  expectedVersion: number,
  repository: SignalPublicationRepository = { withdrawOwnedSignal },
): Promise<WithdrawSignalResponse> {
  if (frequency === undefined) {
    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  }
  if (frequency.status !== "ACTIVE" && frequency.status !== "MUTED") {
    throw new AppError("FORBIDDEN", "This frequency cannot withdraw signals now.");
  }
  const parsed = withdrawalInputSchema.safeParse({ id, expectedVersion });
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid signal withdrawal request.");

  // Do not retry an uncertain commit or turn a storage error into success.
  const result = await repository.withdrawOwnedSignal({ ...parsed.data, actorId: frequency.id });
  if (result.outcome === "NOT_FOUND") throw new AppError("NOT_FOUND", "Signal not found.");
  if (result.outcome === "CONFLICT") {
    throw new AppError("CONFLICT", "Signal publication changed. Refresh before withdrawing.");
  }

  return { withdrawal: { id: result.id, withdrawn: true, publicationVersion: result.publicationVersion } };
}
