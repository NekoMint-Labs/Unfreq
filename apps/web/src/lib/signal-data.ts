import { ApiClientError, apiClient } from "./api-client";
import {
  isPublicSignalDetail,
  isCreateSignalEchoResponse,
  isCreateSignalResponse,
  isEchoSummaryResponse,
  isGalaxyResponse,
  isMySignalsResponse,
  isSavedSignalsResponse,
  isSignalAudioResponse,
  isSignalEchoesResponse,
  isSignalHallResponse,
  isSignalMatchesResponse,
  isPublishSignalResponse,
  isSignalResonanceResponse,
  isSignalResponse,
  isSignalSaveResponse,
} from "./api-response-validators";
import type {
  CreateSignalResponse,
  CreateSignalEchoResponse,
  EchoSummary,
  EchoSummaryResponse,
  GalaxyResponse,
  LatestMonthlyRecapResponse,
  MonthlyRecap,
  MonthlyRecapResponse,
  MySignalsResponse,
  PublishSignalResponse,
  SignalAudioDetail,
  SignalAudioResponse,
  SignalEchoDetail,
  SignalEchoesResponse,
  SignalGenerationDetail,
  SignalHallResponse,
  SignalMatchesResponse,
  SignalResonanceResponse,
  SignalResponse,
  SignalSaveResponse,
  SignalResultDetail,
  OwnerSignalDetail,
  PublicSignalDetail,
  PublishSignalRequest,
  SavedSignalsResponse,
  SignalPrimaryBand,
} from "@unfreq/contracts";

export type CreateSignalInput = {
  parentSignalId?: string;
  seedText: string;
};

export type CreateSignalEchoInput = {
  content: string;
};

export type SignalResonanceInput = Record<string, never>;

export function isSignalDetail(signal: SignalResultDetail): signal is PublicSignalDetail {
  return signal.visibility === "PUBLIC";
}
export function isSignalGenerationDetail(signal: SignalResultDetail): signal is SignalGenerationDetail {
  return signal.visibility === "GENERATION_OWNER";
}
export function isSignalPreviewDetail(signal: SignalResultDetail): signal is OwnerSignalDetail {
  return signal.visibility === "PRIVATE_OWNER";
}
/** Always anonymous, including when a signed-in author opens a share card. */
export async function getPublicSignal(id: string): Promise<PublicSignalDetail | undefined> {
  try {
    const result = await apiClient.get<SignalResponse>(`/api/signals/${encodeURIComponent(id)}`, {
      credentials: "omit", cache: "no-store", validate: isSignalResponse,
    });
    return isPublicSignalDetail(result.signal) ? result.signal : undefined;
  } catch (error) {
    if (error instanceof ApiClientError && [400, 404].includes(error.status)) return undefined;
    throw error;
  }
}

export async function createSignal(input: CreateSignalInput): Promise<SignalGenerationDetail> {
  const result = await apiClient.post<CreateSignalResponse, CreateSignalInput>(
    "/api/signals",
    input,
    { validate: isCreateSignalResponse },
  );

  return result.signal;
}

export async function publishSignal(signalId: string, confirmation: PublishSignalRequest): Promise<OwnerSignalDetail> {
  const result = await apiClient.post<PublishSignalResponse, PublishSignalRequest>(
    `/api/signals/${signalId}/publish`,
    confirmation,
    { validate: isPublishSignalResponse },
  );

  return result.signal;
}

export async function getSignalHall(): Promise<PublicSignalDetail[]> {
  const result = await apiClient.get<SignalHallResponse>("/api/signals/hall", {
    cache: "no-store",
    validate: isSignalHallResponse,
  });

  return result.signals;
}

export async function getSignalGalaxy(
  cookieHeader?: string,
  band?: SignalPrimaryBand,
  focus?: string,
  theme?: string,
): Promise<GalaxyResponse> {
  const params = new URLSearchParams();
  if (band !== undefined) params.set("band", band);
  else if (theme !== undefined) params.set("theme", theme);
  if (focus !== undefined) params.set("focus", focus);
  const query = params.size === 0 ? "" : `?${params}`;

  return apiClient.get<GalaxyResponse>(`/api/signals/galaxy${query}`, {
    cache: "no-store",
    headers: cookieHeader !== undefined && cookieHeader.length > 0
      ? { cookie: cookieHeader }
      : undefined,
    timeoutMs: 2200,
    validate: isGalaxyResponse,
  });
}

export async function getMySignals(cookieHeader?: string, query: { cursor?: string; limit?: number } = {}): Promise<MySignalsResponse> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return apiClient.get<MySignalsResponse>(`/api/me/signals${params.size ? `?${params}` : ""}`, {
    cache: "no-store",
    headers: cookieHeader !== undefined && cookieHeader.length > 0
      ? { cookie: cookieHeader }
      : undefined,
    timeoutMs: 2200,
    validate: isMySignalsResponse,
  });
}

export async function getMyEchoSummary(cookieHeader?: string): Promise<EchoSummary> {
  const result = await apiClient.get<EchoSummaryResponse>("/api/me/echo-summary", {
    cache: "no-store",
    headers: cookieHeader !== undefined && cookieHeader.length > 0
      ? { cookie: cookieHeader }
      : undefined,
    timeoutMs: 2200,
    validate: isEchoSummaryResponse,
  });

  return result.summary;
}

export async function getMySavedSignals(cookieHeader?: string): Promise<SavedSignalsResponse> {
  return apiClient.get<SavedSignalsResponse>("/api/me/saves", {
    cache: "no-store",
    headers: cookieHeader !== undefined && cookieHeader.length > 0
      ? { cookie: cookieHeader }
      : undefined,
    timeoutMs: 2200,
    validate: isSavedSignalsResponse,
  });
}

export async function markMyEchoSummarySeen(): Promise<EchoSummary> {
  const result = await apiClient.post<EchoSummaryResponse, Record<string, never>>(
    "/api/me/echo-summary/seen",
    {},
    { validate: isEchoSummaryResponse },
  );

  return result.summary;
}

export async function getLatestMonthlyRecap(
  cookieHeader?: string,
): Promise<MonthlyRecap | undefined> {
  const result = await apiClient.get<LatestMonthlyRecapResponse>("/api/me/recaps/latest", {
    cache: "no-store",
    headers: cookieHeader !== undefined && cookieHeader.length > 0
      ? { cookie: cookieHeader }
      : undefined,
    timeoutMs: 2200,
  });

  return result.recap;
}

export async function getMonthlyRecap(
  yearMonth: string,
  cookieHeader?: string,
): Promise<MonthlyRecap | undefined> {
  try {
    const result = await apiClient.get<MonthlyRecapResponse>(
      `/api/me/recaps/${encodeURIComponent(yearMonth)}`,
      {
        cache: "no-store",
        headers: cookieHeader !== undefined && cookieHeader.length > 0
          ? { cookie: cookieHeader }
          : undefined,
      },
    );

    return result.recap;
  } catch (caughtError) {
    if (
      caughtError instanceof ApiClientError &&
      (caughtError.status === 400 || caughtError.status === 404)
    ) {
      return undefined;
    }

    throw caughtError;
  }
}

export async function generateMonthlyRecap(yearMonth?: string): Promise<MonthlyRecap> {
  const result = await apiClient.post<MonthlyRecapResponse, { yearMonth?: string }>(
    "/api/me/recaps",
    yearMonth === undefined ? {} : { yearMonth },
  );

  return result.recap;
}

export async function getRandomSignal(): Promise<PublicSignalDetail | undefined> {
  try {
    const result = await apiClient.get<SignalResponse>("/api/signals/random", {
      cache: "no-store",
      validate: isSignalResponse,
    });

    return isSignalDetail(result.signal) ? result.signal : undefined;
  } catch (caughtError) {
    if (caughtError instanceof ApiClientError && caughtError.status === 404) {
      return undefined;
    }

    throw caughtError;
  }
}

export async function getSignal(
  id: string,
  cookieHeader?: string,
  options?: { signal?: AbortSignal },
): Promise<SignalResultDetail | undefined> {
  try {
    const result = await apiClient.get<SignalResponse>(`/api/signals/${id}`, {
      cache: "no-store",
        signal: options?.signal,
      headers: cookieHeader !== undefined && cookieHeader.length > 0
        ? { cookie: cookieHeader }
        : undefined,
      validate: isSignalResponse,
    });

    return result.signal;
  } catch (caughtError) {
    if (
      caughtError instanceof ApiClientError &&
      (caughtError.status === 400 || caughtError.status === 404)
    ) {
      return undefined;
    }

    throw caughtError;
  }
}

export async function getSignalAudio(signalId: string): Promise<SignalAudioDetail> {
  const result = await apiClient.get<SignalAudioResponse>(`/api/signals/${signalId}/audio`, {
    cache: "no-store",
    validate: isSignalAudioResponse,
  });

  return result.audio;
}

export async function requestSignalAudio(signalId: string): Promise<SignalAudioDetail> {
  const result = await apiClient.post<SignalAudioResponse, Record<string, never>>(
    `/api/signals/${signalId}/audio`,
    {},
    { validate: isSignalAudioResponse },
  );

  return result.audio;
}

export async function getSignalMatches(id: string): Promise<SignalMatchesResponse["matches"]> {
  const result = await apiClient.get<SignalMatchesResponse>(`/api/signals/${id}/matches`, {
    cache: "no-store",
    validate: isSignalMatchesResponse,
  });

  return result.matches;
}

export async function getSignalEchoes(id: string): Promise<SignalEchoDetail[] | undefined> {
  try {
    const result = await apiClient.get<SignalEchoesResponse>(`/api/signals/${id}/echoes`, {
      cache: "no-store",
      validate: isSignalEchoesResponse,
    });

    return result.echoes;
  } catch (caughtError) {
    if (
      caughtError instanceof ApiClientError &&
      (caughtError.status === 400 || caughtError.status === 404)
    ) {
      return undefined;
    }

    throw caughtError;
  }
}

export async function createSignalEcho(
  signalId: string,
  input: CreateSignalEchoInput,
): Promise<SignalEchoDetail> {
  const result = await apiClient.post<CreateSignalEchoResponse, CreateSignalEchoInput>(
    `/api/signals/${signalId}/echoes`,
    input,
    { validate: isCreateSignalEchoResponse },
  );

  return result.echo;
}

export async function addSignalResonance(
  signalId: string,
  input: SignalResonanceInput,
): Promise<SignalResonanceResponse["resonance"]> {
  const result = await apiClient.post<SignalResonanceResponse, SignalResonanceInput>(
    `/api/signals/${signalId}/resonance`,
    input,
    { validate: isSignalResonanceResponse },
  );

  return result.resonance;
}

export async function removeSignalResonance(
  signalId: string,
  input: SignalResonanceInput,
): Promise<SignalResonanceResponse["resonance"]> {
  const result = await apiClient.delete<SignalResonanceResponse, SignalResonanceInput>(
    `/api/signals/${signalId}/resonance`,
    {
      body: input,
      validate: isSignalResonanceResponse,
    },
  );

  return result.resonance;
}

export async function saveSignal(signalId: string): Promise<SignalSaveResponse["save"]> {
  const result = await apiClient.post<SignalSaveResponse, Record<string, never>>(
    `/api/signals/${signalId}/save`,
    {},
    { validate: isSignalSaveResponse },
  );

  return result.save;
}

export async function unsaveSignal(signalId: string): Promise<SignalSaveResponse["save"]> {
  const result = await apiClient.delete<SignalSaveResponse, Record<string, never>>(
    `/api/signals/${signalId}/save`,
    {
      body: {},
      validate: isSignalSaveResponse,
    },
  );

  return result.save;
}
