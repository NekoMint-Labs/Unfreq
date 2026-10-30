import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { OwnerSignalDetail } from "@unfreq/contracts/signals";
import { confirmSignalPublicationForOwner } from "./service-publication-confirmation.js";
import { getSignalDetailForFrequency } from "./service-queries.js";

export async function publishSignalForOwner(id: string, frequency: AuthenticatedFrequency | undefined, request: unknown): Promise<OwnerSignalDetail> {
  const confirmed = await confirmSignalPublicationForOwner(id, frequency, request);
  const detail = await getSignalDetailForFrequency(id, frequency);
  if (detail.visibility !== "PRIVATE_OWNER" || detail.publication.state !== "PUBLIC" || detail.publication.version !== confirmed.publicationVersion) {
    throw new AppError("CONFLICT", "Signal publication changed. Refresh before continuing.");
  }
  return detail;
}
