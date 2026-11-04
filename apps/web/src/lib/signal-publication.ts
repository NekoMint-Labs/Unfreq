import { ApiClientError, apiClient } from "./api-client";
import { maxSignalPublicationVersion, type WithdrawSignalRequest, type WithdrawSignalResponse } from "@unfreq/contracts";
export type { WithdrawSignalResponse } from "@unfreq/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isPublicationVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maxSignalPublicationVersion;
}

export function isWithdrawSignalResponse(
  value: unknown,
  signalId: string,
  expectedVersion: number,
): value is WithdrawSignalResponse {
  if (
    !isPublicationVersion(expectedVersion) ||
    !isRecord(value) ||
    !hasExactKeys(value, ["withdrawal"]) ||
    !isRecord(value.withdrawal) ||
    !hasExactKeys(value.withdrawal, ["id", "withdrawn", "publicationVersion"])
  ) {
    return false;
  }

  return (
    value.withdrawal.id === signalId &&
    value.withdrawal.withdrawn === true &&
    isPublicationVersion(value.withdrawal.publicationVersion) &&
    value.withdrawal.publicationVersion >= expectedVersion
  );
}

export async function withdrawSignal(
  signalId: string,
  expectedVersion: number,
): Promise<WithdrawSignalResponse> {
  if (signalId.length === 0 || !isPublicationVersion(expectedVersion)) {
    throw new ApiClientError({
      code: "INVALID_REQUEST",
      message: "Signal withdrawal request did not match the expected contract.",
      status: 0,
    });
  }

  return apiClient.post<WithdrawSignalResponse, WithdrawSignalRequest>(
    `/api/signals/${encodeURIComponent(signalId)}/withdraw`,
    { expectedVersion },
    {
      cache: "no-store",
      validate: (value): value is WithdrawSignalResponse =>
        isWithdrawSignalResponse(value, signalId, expectedVersion),
    },
  );
}
