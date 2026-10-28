export type AiChannel = "MIDNIGHT" | "STARMAP" | "UNSENT";

export type AiClassification = {
  channel: AiChannel;
  confidence: number;
  reason: string;
};

export type AiTagSuggestion = {
  tags: string[];
};

export type AiModeration = {
  action: "ALLOW" | "HIDE" | "REVIEW";
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export type AiContentAnalysis = {
  emotions: string[];
  intensity: number;
  keywords: string[];
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
};

export type AiEchoSuggestion = {
  suggestion: string;
};
