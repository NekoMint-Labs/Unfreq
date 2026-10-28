import { ApiClientError, isApiUnavailableError } from "@/lib/api-client";
import {
  getLatestMonthlyRecap,
  getMyEchoSummary,
  getMySavedSignals,
  getMySignals,
} from "@/lib/signal-data";
import type { MonthlyRecap } from "@unfreq/contracts";

export type FrequencyOptionalData = {
  areSavedSignalsUnavailable: boolean;
  echoSummary: Awaited<ReturnType<typeof getMyEchoSummary>>;
  isEchoSummaryUnavailable: boolean;
  isLatestRecapUnavailable: boolean;
  latestRecap?: MonthlyRecap;
  savedSignals: Awaited<ReturnType<typeof getMySavedSignals>>;
};

export type MyFrequencySignalsState =
  | {
      isUnavailable: false;
      value: Awaited<ReturnType<typeof getMySignals>>;
    }
  | {
      isUnavailable: true;
      value: Awaited<ReturnType<typeof getMySignals>>;
    };

export function createEmptyEchoSummary(params: {
  frequencyId: string;
  totalResonanceCount: number;
}): Awaited<ReturnType<typeof getMyEchoSummary>> {
  return {
    frequencyId: params.frequencyId,
    newResonanceCount: 0,
    totalResonanceCount: params.totalResonanceCount,
  };
}

export function createEmptySavedSignals(): Awaited<ReturnType<typeof getMySavedSignals>> {
  return {
    signals: [],
  };
}

export function createEmptyMySignals(): Awaited<ReturnType<typeof getMySignals>> {
  return {
    signals: [],
    totalResonanceCount: 0,
  };
}

function canDegradeMyFrequencyOptionalData(error: unknown): boolean {
  if (isApiUnavailableError(error)) {
    return true;
  }

  return error instanceof ApiClientError;
}

export async function getOptionalFrequencyData(params: {
  cookieHeader: string;
  frequencyId: string;
  mySignals: Awaited<ReturnType<typeof getMySignals>>;
  skipEchoSummary?: boolean;
}): Promise<FrequencyOptionalData> {
  const echoSummaryPromise = params.skipEchoSummary === true
    ? Promise.resolve(
        createEmptyEchoSummary({
          frequencyId: params.frequencyId,
          totalResonanceCount: params.mySignals.totalResonanceCount,
        }),
      )
    : getMyEchoSummary(params.cookieHeader);
  const [echoSummaryResult, latestRecapResult, savedSignalsResult] =
    await Promise.allSettled([
      echoSummaryPromise,
      getLatestMonthlyRecap(params.cookieHeader),
      getMySavedSignals(params.cookieHeader),
    ]);

  if (
    echoSummaryResult.status === "rejected" &&
    !canDegradeMyFrequencyOptionalData(echoSummaryResult.reason)
  ) {
    throw echoSummaryResult.reason;
  }

  if (
    latestRecapResult.status === "rejected" &&
    !canDegradeMyFrequencyOptionalData(latestRecapResult.reason)
  ) {
    throw latestRecapResult.reason;
  }

  if (
    savedSignalsResult.status === "rejected" &&
    !canDegradeMyFrequencyOptionalData(savedSignalsResult.reason)
  ) {
    throw savedSignalsResult.reason;
  }

  return {
    areSavedSignalsUnavailable: savedSignalsResult.status === "rejected",
    echoSummary: echoSummaryResult.status === "fulfilled"
      ? echoSummaryResult.value
      : createEmptyEchoSummary({
          frequencyId: params.frequencyId,
          totalResonanceCount: params.mySignals.totalResonanceCount,
        }),
    isEchoSummaryUnavailable:
      params.skipEchoSummary === true || echoSummaryResult.status === "rejected",
    isLatestRecapUnavailable: latestRecapResult.status === "rejected",
    latestRecap: latestRecapResult.status === "fulfilled"
      ? latestRecapResult.value
      : undefined,
    savedSignals: savedSignalsResult.status === "fulfilled"
      ? savedSignalsResult.value
      : createEmptySavedSignals(),
  };
}
