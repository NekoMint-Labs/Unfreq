export type HomeEntryPhase = "locked" | "ready" | "transmitting" | "failed";

export type HomeEntryStateCopy = {
  message?: string;
  lockedHint?: string;
};

export function getHomeEntryStateCopy(
  phase: HomeEntryPhase,
  isApiUnavailable: boolean,
): HomeEntryStateCopy {
  if (phase === "failed") {
    return {
      message: isApiUnavailable
        ? "当前 API 没有响应。页面仍可检查视觉结构。"
        : "频率暂时离线。刷新后重试。",
    };
  }

  if (phase === "transmitting") {
    return {
      message: "seed 正在穿过星海。",
    };
  }

  if (phase === "locked") {
    return {
      message: "FM 接入后才能发射 seed。",
      lockedHint: "先接入 FM 频率",
    };
  }

  return {};
}
