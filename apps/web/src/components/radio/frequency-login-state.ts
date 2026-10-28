import { ApiClientError } from "../../lib/api-client";

export type FrequencyLoginErrorSource = "login" | "register";

export type FrequencyLoginErrorState = {
  message: string;
  source: FrequencyLoginErrorSource;
};

export type FrequencyCopyStatus = "idle" | "copied" | "failed" | "unavailable";

type FrequencyClipboard = {
  writeText?: unknown;
};

export const isFrequencyClipboardAvailable = (
  clipboard: FrequencyClipboard | undefined,
): boolean => {
  return typeof clipboard?.writeText === "function";
};

export const toFrequencyLoginErrorMessage = (caughtError: unknown): string => {
  if (caughtError instanceof ApiClientError) {
    if (caughtError.code === "VALIDATION_ERROR") {
      return "FM 或密码格式不对。";
    }

    if (caughtError.code === "UNAUTHORIZED") {
      return "FM 或密码没有对上。";
    }

    if (caughtError.code === "FORBIDDEN") {
      return "这个频率暂时不能接入。";
    }
  }

  return "调频失败，稍后再试。";
};

export const getFrequencyCopyStatusMessage = (
  status: FrequencyCopyStatus,
): string | undefined => {
  if (status === "copied") {
    return "FM 已复制。请同时保存你的密码。";
  }

  if (status === "failed") {
    return "复制没有完成，请手动保存这个 FM。";
  }

  if (status === "unavailable") {
    return "当前浏览器不能直接复制，请手动保存这个 FM。";
  }

  return undefined;
};
