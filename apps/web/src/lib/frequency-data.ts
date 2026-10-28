import { ApiClientError, apiClient } from "@/lib/api-client";
import { isMeResponse } from "@/lib/api-response-validators";
import type { FrequencyIdentity, MeResponse } from "@unfreq/contracts";

export function getFrequencyCode(frequency: FrequencyIdentity): string {
  return frequency.code ?? frequency.freqCode;
}

export async function getBrowserFrequency(): Promise<FrequencyIdentity | undefined> {
  try {
    const result = await apiClient.get<MeResponse>("/api/me", {
      cache: "no-store",
      timeoutMs: 5000,
      validate: isMeResponse,
    });

    if (result.frequency.isGuest === true) {
      return undefined;
    }

    return result.frequency;
  } catch (caughtError) {
    if (caughtError instanceof ApiClientError && caughtError.status === 401) {
      return undefined;
    }

    throw caughtError;
  }
}
