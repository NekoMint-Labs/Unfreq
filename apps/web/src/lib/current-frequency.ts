import { cookies } from "next/headers";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { isMeResponse } from "@/lib/api-response-validators";
import type { FrequencyIdentity, MeResponse } from "@unfreq/contracts";

export async function getCurrentFrequency(): Promise<FrequencyIdentity | undefined> {
  const current = await getCurrentMe();

  if (current?.frequency.isGuest === true) {
    return undefined;
  }

  return current?.frequency;
}

export async function getCurrentMe(): Promise<MeResponse | undefined> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  try {
    return await apiClient.get<MeResponse>("/api/me", {
      cache: "no-store",
      headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : undefined,
      timeoutMs: 2200,
      validate: isMeResponse,
    });
  } catch (caughtError) {
    if (caughtError instanceof ApiClientError && caughtError.status === 401) {
      return undefined;
    }

    throw caughtError;
  }
}
