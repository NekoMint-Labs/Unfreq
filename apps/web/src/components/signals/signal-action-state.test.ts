import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import {
  getSignalActionFeedbackState,
  getSignalPlaybackFallbackMessage,
  getSignalResonanceButtonState,
  getSignalResonanceErrorMessage,
  getSignalSaveButtonState,
  getSignalSaveErrorMessage,
  getSignalShareButtonState,
  getSignalShareErrorMessage,
} from "./signal-action-state";

const buildApiError = (status: number): ApiClientError => {
  return new ApiClientError({
    code: status === 401 ? "UNAUTHORIZED" : "NOT_FOUND",
    message: "test error",
    status,
  });
};

describe("signal action state helpers", () => {
  it("uses one inline feedback shape for pending, success, and failure states", () => {
    expect(
      getSignalActionFeedbackState({
        isPending: false,
        successMessage: "已经复制信号链接。",
      }),
    ).toEqual({
      kind: "status",
      message: "已经复制信号链接。",
    });

    expect(
      getSignalActionFeedbackState({
        isPending: true,
        pendingMessage: "正在保存共鸣。",
        successMessage: "已经保存共鸣。",
      }),
    ).toEqual({
      kind: "status",
      message: "正在保存共鸣。",
    });

    expect(
      getSignalActionFeedbackState({
        error: "共鸣暂时没有送出。",
        isPending: true,
        pendingMessage: "正在保存共鸣。",
      }),
    ).toEqual({
      kind: "error",
      message: "共鸣暂时没有送出。",
    });
  });

  it("disables resonance after success and preserves the returned count", () => {
    expect(
      getSignalResonanceButtonState({
        count: 8,
        hasResonated: true,
        isPending: false,
        labelPrefix: "[共振] ",
      }),
    ).toEqual({
      disabled: true,
      label: "[共振] 已共鸣 · 8",
    });
  });

  it("keeps resonance available before click and blocks duplicate pending submits", () => {
    expect(
      getSignalResonanceButtonState({
        count: 3,
        hasResonated: false,
        isPending: false,
      }),
    ).toEqual({
      disabled: false,
      label: "我也想过 · 3",
    });

    expect(
      getSignalResonanceButtonState({
        count: 3,
        hasResonated: false,
        isPending: true,
      }).disabled,
    ).toBe(true);
  });

  it("maps resonance API failures to stable user-facing copy", () => {
    expect(getSignalResonanceErrorMessage(buildApiError(404))).toBe(
      "这段信号暂时无法共鸣。",
    );
    expect(getSignalResonanceErrorMessage(new Error("network"))).toBe(
      "共鸣暂时没有送出。",
    );
  });

  it("shows save and saved labels while only pending disables the save button", () => {
    expect(
      getSignalSaveButtonState({
        hasSaved: false,
        isPending: false,
        labelPrefix: "[保存] ",
      }),
    ).toEqual({
      disabled: false,
      label: "[保存] 收藏",
    });

    expect(
      getSignalSaveButtonState({
        hasSaved: true,
        isPending: false,
      }),
    ).toEqual({
      disabled: false,
      label: "已收藏",
    });

    expect(
      getSignalSaveButtonState({
        hasSaved: true,
        isPending: true,
      }).disabled,
    ).toBe(true);
  });

  it("maps save API failures to auth, missing signal, and generic copy", () => {
    expect(getSignalSaveErrorMessage(buildApiError(401))).toBe(
      "频率还没接入。刷新后再试一次。",
    );
    expect(getSignalSaveErrorMessage(buildApiError(404))).toBe(
      "这段信号暂时不能收藏。",
    );
    expect(getSignalSaveErrorMessage(new Error("timeout"))).toBe(
      "收藏状态暂时没有保存。",
    );
  });

  it("returns stable copy-link button labels and disables while pending", () => {
    expect(getSignalShareButtonState({ isPending: false })).toEqual({
      disabled: false,
      label: "复制链接",
    });
    expect(getSignalShareButtonState({ isPending: true })).toEqual({
      disabled: true,
      label: "复制中",
    });
  });

  it("maps clipboard failures to user-facing copy", () => {
    expect(
      getSignalShareErrorMessage(
        new DOMException("clipboard denied", "NotAllowedError"),
      ),
    ).toBe("浏览器暂时不允许复制。");
    expect(getSignalShareErrorMessage(new Error("missing clipboard"))).toBe(
      "信号链接暂时没有复制。",
    );
  });

  it("keeps playback fallback copy behind the same state helper", () => {
    expect(getSignalPlaybackFallbackMessage("FAILED")).toBe(
      "服务端音频暂不可用，文本仍可阅读。",
    );
    expect(getSignalPlaybackFallbackMessage("READY")).toBeUndefined();
    expect(getSignalPlaybackFallbackMessage(undefined)).toBeUndefined();
  });
});
