import { db } from "../../db/client.js";
import { aiReviews } from "../../db/schema.js";
import type { AiReviewRecord } from "./types.js";

function toCurrentTargetType(value: string | null): AiReviewRecord["targetType"] {
  if (value === "SIGNAL" || value === "USER") {
    return value;
  }

  return undefined;
}

export async function createAiReviewRecord(params: {
  inputText: string;
  model: string;
  outputJson: Record<string, unknown>;
  provider: string;
  reviewType: string;
  status: "FALLBACK" | "SUCCEEDED";
  targetId?: string;
  targetType?: "SIGNAL" | "USER";
}): Promise<AiReviewRecord> {
  const [review] = await db
    .insert(aiReviews)
    .values({
      inputText: params.inputText,
      model: params.model,
      outputJson: params.outputJson,
      provider: params.provider,
      reviewType: params.reviewType,
      status: params.status,
      targetId: params.targetId,
      targetType: params.targetType,
    })
    .returning();

  if (review === undefined) {
    throw new Error("AI review insert returned no row.");
  }

  return {
    createdAt: review.createdAt.toISOString(),
    id: review.id,
    inputText: review.inputText,
    model: review.model,
    outputJson: review.outputJson as Record<string, unknown>,
    provider: review.provider,
    reviewType: review.reviewType,
    status: review.status as "FALLBACK" | "SUCCEEDED",
    targetId: review.targetId ?? undefined,
    targetType: toCurrentTargetType(review.targetType),
  };
}
