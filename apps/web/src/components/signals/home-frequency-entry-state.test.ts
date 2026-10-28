import { describe, expect, it } from "vitest";
import { getHomeEntryStateCopy } from "./home-frequency-entry-state";

describe("home frequency entry state", () => {
  it("keeps unauthenticated copy distinct from API unavailable copy", () => {
    expect(getHomeEntryStateCopy("locked", false)).toEqual({
      message: "FM 接入后才能发射 seed。",
      lockedHint: "先接入 FM 频率",
    });

    expect(getHomeEntryStateCopy("failed", true)).toEqual({
      message: "当前 API 没有响应。页面仍可检查视觉结构。",
    });
  });

  it("shows no locked guidance when the frequency is ready", () => {
    expect(getHomeEntryStateCopy("ready", false)).toEqual({});
  });

  it("preserves the active transmission copy", () => {
    expect(getHomeEntryStateCopy("transmitting", false)).toEqual({
      message: "seed 正在穿过星海。",
    });
  });
});
