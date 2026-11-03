export type * from "./legacy-types.js";
export type * from "./signal-types.js";

export type AiReviewRecord = {
  execution?: import("./provider-execution.js").AiExecutionMetadata;
  createdAt: string;
  id: string;
  inputText: string;
  model: string;
  outputJson: Record<string, unknown>;
  provider: string;
  reviewType: string;
  status: "FALLBACK" | "SUCCEEDED";
  targetId?: string;
  targetType?: "SIGNAL" | "USER";
};
