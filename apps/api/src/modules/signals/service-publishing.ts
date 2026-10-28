import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import {
  findSignalResultById,
  publishSignalForFrequency,
} from "./repository.js";
import { getSignalDetailForFrequency } from "./service-queries.js";
import type { SignalDetail } from "./types.js";

function requireActiveSignalFrequency(
  frequency: AuthenticatedFrequency | undefined,
): AuthenticatedFrequency {
  if (frequency === undefined) {
    throw new AppError("UNAUTHORIZED", "Frequency login required.");
  }

  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot publish now.");
  }

  return frequency;
}

function isOwnedByFrequency(params: {
  frequencyId: string;
  signal: NonNullable<Awaited<ReturnType<typeof findSignalResultById>>>;
}): boolean {
  return (
    params.signal.frequencyId === params.frequencyId ||
    params.signal.authorId === params.frequencyId
  );
}

export async function publishSignalForOwner(
  id: string,
  frequency: AuthenticatedFrequency | undefined,
): Promise<SignalDetail> {
  const activeFrequency = requireActiveSignalFrequency(frequency);
  const signal = await findSignalResultById(id);

  if (signal === undefined || !isOwnedByFrequency({ frequencyId: activeFrequency.id, signal })) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.generationStatus !== "COMPLETED") {
    throw new AppError("CONFLICT", "Signal generation is not complete.");
  }

  if (signal.status === "REVIEWING") {
    throw new AppError("CONFLICT", "Signal requires review before publishing.");
  }

  if (signal.status !== "DRAFT" && signal.status !== "PUBLISHED") {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  if (signal.status === "DRAFT") {
    const publishedSignal = await publishSignalForFrequency({
      frequencyId: activeFrequency.id,
      id,
    });

    if (publishedSignal === undefined) {
      throw new AppError("CONFLICT", "Signal could not be published.");
    }
  }

  const detail = await getSignalDetailForFrequency(id, activeFrequency);

  if ("visibility" in detail) {
    throw new AppError("CONFLICT", "Signal could not be published.");
  }

  return detail;
}
