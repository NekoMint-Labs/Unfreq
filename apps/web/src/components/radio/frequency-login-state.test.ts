import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import {
  getFrequencyCopyStatusMessage,
  isFrequencyClipboardAvailable,
  toFrequencyLoginErrorMessage,
} from "./frequency-login-state";

const buildApiError = (code: string): ApiClientError => {
  return new ApiClientError({
    code,
    message: "test error",
    status: 400,
  });
};

describe("frequency login state helpers", () => {
  it("maps auth API errors to stable visible copy", () => {
    expect(toFrequencyLoginErrorMessage(buildApiError("VALIDATION_ERROR"))).toBe(
      "FM 或密码格式不对。",
    );
    expect(toFrequencyLoginErrorMessage(buildApiError("UNAUTHORIZED"))).toBe(
      "FM 或密码没有对上。",
    );
    expect(toFrequencyLoginErrorMessage(buildApiError("FORBIDDEN"))).toBe(
      "这个频率暂时不能接入。",
    );
    expect(toFrequencyLoginErrorMessage(new Error("network"))).toBe(
      "调频失败，稍后再试。",
    );
  });

  it("returns visible feedback for FM copy outcomes", () => {
    expect(getFrequencyCopyStatusMessage("idle")).toBeUndefined();
    expect(getFrequencyCopyStatusMessage("copied")).toBe("FM 已复制。请同时保存你的密码。");
    expect(getFrequencyCopyStatusMessage("failed")).toBe(
      "复制没有完成，请手动保存这个 FM。",
    );
    expect(getFrequencyCopyStatusMessage("unavailable")).toBe(
      "当前浏览器不能直接复制，请手动保存这个 FM。",
    );
  });

  it("detects whether the browser can copy an FM code", () => {
    expect(isFrequencyClipboardAvailable(undefined)).toBe(false);
    expect(isFrequencyClipboardAvailable({})).toBe(false);
    expect(isFrequencyClipboardAvailable({ writeText: "missing" })).toBe(false);
    expect(isFrequencyClipboardAvailable({ writeText: () => Promise.resolve() })).toBe(true);
  });
});
