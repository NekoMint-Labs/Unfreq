export const signalGenerationProgressSteps = [
  "接收 seed",
  "生成同频指纹",
  "搜索附近频率",
  "写入扩展信号",
] as const;

export const getSignalGenerationProgressSteps = (
  isActive: boolean,
): readonly string[] => {
  if (!isActive) {
    return [];
  }

  return signalGenerationProgressSteps;
};
