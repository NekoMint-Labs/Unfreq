import { describe, expect, it } from "vitest";
import { getSignalGenerationProgressSteps } from "./signal-generation-progress-state";

describe("signal generation progress state", () => {
  it("keeps progress hidden while signal generation is inactive", () => {
    expect(getSignalGenerationProgressSteps(false)).toEqual([]);
  });

  it("shows the visible seed transmission steps while active", () => {
    expect(getSignalGenerationProgressSteps(true)).toEqual([
      "接收 seed",
      "生成同频指纹",
      "搜索附近频率",
      "写入扩展信号",
    ]);
  });
});
