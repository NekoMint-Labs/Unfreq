import { ApiClientError } from "../../lib/api-client";

type SignalResonanceStateInput = {
  count: number;
  hasResonated: boolean;
  isPending: boolean;
  labelPrefix?: string;
};

type SignalSaveStateInput = {
  hasSaved: boolean;
  isPending: boolean;
  labelPrefix?: string;
};

type SignalShareStateInput = {
  isPending: boolean;
};

export type SignalActionButtonState = {
  disabled: boolean;
  label: string;
};

export type SignalActionFeedbackState = {
  kind: "error" | "status";
  message: string;
};

type SignalActionFeedbackInput = {
  error?: string;
  isPending: boolean;
  pendingMessage?: string;
  successMessage?: string;
};

export function getSignalActionFeedbackState({
  error,
  isPending,
  pendingMessage,
  successMessage,
}: SignalActionFeedbackInput): SignalActionFeedbackState | undefined {
  if (error !== undefined) {
    return {
      kind: "error",
      message: error,
    };
  }

  if (isPending && pendingMessage !== undefined) {
    return {
      kind: "status",
      message: pendingMessage,
    };
  }

  if (!isPending && successMessage !== undefined) {
    return {
      kind: "status",
      message: successMessage,
    };
  }

  return undefined;
}

export function getSignalResonanceButtonState({
  count,
  hasResonated,
  isPending,
  labelPrefix = "",
}: SignalResonanceStateInput): SignalActionButtonState {
  return {
    disabled: isPending || hasResonated,
    label: `${labelPrefix}${hasResonated ? "已共鸣" : "我也想过"} · ${count}`,
  };
}

export function getSignalResonanceErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof ApiClientError && caughtError.status === 404) {
    return "这段信号暂时无法共鸣。";
  }

  return "共鸣暂时没有送出。";
}

export function getSignalSaveButtonState({
  hasSaved,
  isPending,
  labelPrefix = "",
}: SignalSaveStateInput): SignalActionButtonState {
  return {
    disabled: isPending,
    label: `${labelPrefix}${hasSaved ? "已收藏" : "收藏"}`,
  };
}

export function getSignalSaveErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof ApiClientError && caughtError.status === 401) {
    return "频率还没接入。刷新后再试一次。";
  }

  if (caughtError instanceof ApiClientError && caughtError.status === 404) {
    return "这段信号暂时不能收藏。";
  }

  return "收藏状态暂时没有保存。";
}

export function getSignalShareButtonState({
  isPending,
}: SignalShareStateInput): SignalActionButtonState {
  return {
    disabled: isPending,
    label: isPending ? "复制中" : "复制链接",
  };
}

export function getSignalShareErrorMessage(caughtError: unknown): string {
  if (
    caughtError instanceof DOMException &&
    (caughtError.name === "NotAllowedError" || caughtError.name === "SecurityError")
  ) {
    return "浏览器暂时不允许复制。";
  }

  return "信号链接暂时没有复制。";
}

export function getSignalPlaybackFallbackMessage(
  audioStatus: SignalAudioStatusLike | undefined,
): string | undefined {
  if (audioStatus !== "FAILED") {
    return undefined;
  }

  return "服务端音频暂不可用，文本仍可阅读。";
}

type SignalAudioStatusLike = "FAILED" | "NOT_REQUESTED" | "PENDING" | "READY";
