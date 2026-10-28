import { AppError } from "../../shared/errors.js";
import { resolveChatProviderConfig } from "./provider-config.js";
import { createAiReviewRecord } from "./repository.js";
import {
  aiClassificationSchema,
  aiContentAnalysisSchema,
  aiEchoSuggestionSchema,
  aiModerationSchema,
  aiMonthlyRecapSchema,
  aiSignalContentSchema,
  aiSignalExpansionReviewSchema,
  aiSignalExpansionSchema,
  aiSignalFingerprintSchema,
  aiSignalMaterialSchema,
  aiSignalProgramSchema,
  aiSignalQualitySchema,
  aiSignalSeedClassificationSchema,
  aiTagSuggestionSchema,
} from "./schemas.js";
import {
  classifyFallback,
  classifyWithProvider,
  contentAnalysisFallback,
  contentAnalysisWithProvider,
  echoFallback,
  echoSuggestionWithProvider,
  moderateFallback,
  moderateWithProvider,
  monthlyRecapFallback,
  monthlyRecapWithProvider,
  signalFingerprintFallback,
  signalFingerprintWithProvider,
  signalContentFallback,
  signalContentWithProvider,
  signalExpansionReviewFallback,
  signalExpansionReviewWithProvider,
  signalExpansionWithProvider,
  signalMaterialWithProvider,
  signalProgramFallback,
  signalProgramWithProvider,
  signalQualityFallback,
  signalQualityWithProvider,
  classifySignalSeedFallback,
  signalIntentAnalysisWithProvider,
  signalSeedClassificationWithProvider,
  tagsFallback,
  tagsWithProvider,
} from "./provider.js";
import type { AiContentBody } from "./schemas.js";
import type {
  AiClassification,
  AiContentAnalysis,
  AiEchoSuggestion,
  AiModeration,
  AiTagSuggestion,
} from "./legacy-types.js";
import type {
  AiMonthlyRecap,
  AiSignalContent,
  AiSignalContentInput,
  AiSignalExpansion,
  AiSignalExpansionReview,
  AiSignalExpansionReviewInput,
  AiSignalExpansionInput,
  AiSignalMaterial,
  AiSignalProgramInput,
  AiSignalQuality,
  AiSignalQualityInput,
  AiSignalSeedClassification,
} from "./signal-types.js";

type AiReviewTarget = {
  targetId?: string;
  targetType?: "SIGNAL" | "USER";
};

type AiResultSchema<TOutput> = {
  safeParse: (data: unknown) => { data: TOutput; success: true } | { success: false };
};

function toOutputJson(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {
    value,
  };
}

async function recordAiReview(params: {
  inputText: string;
  output: unknown;
  reviewType: string;
  status: "FALLBACK" | "SUCCEEDED";
} & AiReviewTarget) {
  const providerConfig = await resolveChatProviderConfig();

  return createAiReviewRecord({
    inputText: params.inputText,
    model: providerConfig.model,
    outputJson: toOutputJson(params.output),
    provider: providerConfig.provider,
    reviewType: params.reviewType,
    status: params.status,
    targetId: params.targetId,
    targetType: params.targetType,
  });
}

function parseAiResult<TOutput>(value: unknown, schema: AiResultSchema<TOutput>): TOutput {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AppError("AI_UNAVAILABLE", "AI provider returned invalid JSON.");
  }

  return parsed.data;
}

async function runAi<TOutput>(params: {
  inputText: string;
  parse: (value: unknown) => TOutput;
  reviewType: string;
  providerCall: () => Promise<unknown>;
} & AiReviewTarget): Promise<{ reviewId: string; result: TOutput }> {
  const rawResult = await params.providerCall();
  const result = params.parse(rawResult);
  const review = await recordAiReview({
    inputText: params.inputText,
    output: result,
    reviewType: params.reviewType,
    status: "SUCCEEDED",
    targetId: params.targetId,
    targetType: params.targetType,
  });

  return {
    reviewId: review.id,
    result,
  };
}

async function runAiWithFallback<TOutput>(params: {
  fallbackCall: () => TOutput;
  inputText: string;
  parse: (value: unknown) => TOutput;
  reviewType: string;
  providerCall: () => Promise<unknown>;
} & AiReviewTarget): Promise<{ reviewId: string; result: TOutput }> {
  try {
    return await runAi(params);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "AI_UNAVAILABLE") {
      throw error;
    }

    const result = params.fallbackCall();
    const review = await recordAiReview({
      inputText: params.inputText,
      output: result,
      reviewType: params.reviewType,
      status: "FALLBACK",
      targetId: params.targetId,
      targetType: params.targetType,
    });

    return {
      reviewId: review.id,
      result,
    };
  }
}

export async function classifyContent(body: AiContentBody, target?: AiReviewTarget) {
  return runAi<AiClassification>({
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiClassificationSchema),
    providerCall: () => classifyWithProvider(body.content),
    reviewType: "classify",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function classifyContentWithFallback(body: AiContentBody, target?: AiReviewTarget) {
  return runAiWithFallback<AiClassification>({
    fallbackCall: () => classifyFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiClassificationSchema),
    providerCall: () => classifyWithProvider(body.content),
    reviewType: "classify",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function suggestTags(body: AiContentBody, target?: AiReviewTarget) {
  return runAi<AiTagSuggestion>({
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiTagSuggestionSchema),
    providerCall: () => tagsWithProvider(body.content),
    reviewType: "tags",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function suggestTagsWithFallback(body: AiContentBody, target?: AiReviewTarget) {
  return runAiWithFallback<AiTagSuggestion>({
    fallbackCall: () => tagsFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiTagSuggestionSchema),
    providerCall: () => tagsWithProvider(body.content),
    reviewType: "tags",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function moderateContent(body: AiContentBody, target?: AiReviewTarget) {
  return runAi<AiModeration>({
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiModerationSchema),
    providerCall: () => moderateWithProvider(body.content),
    reviewType: "moderate",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function moderateContentWithFallback(body: AiContentBody, target?: AiReviewTarget) {
  return runAiWithFallback<AiModeration>({
    fallbackCall: () => moderateFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiModerationSchema),
    providerCall: () => moderateWithProvider(body.content),
    reviewType: "moderate",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function analyzeContent(body: AiContentBody, target?: AiReviewTarget) {
  return runAi<AiContentAnalysis>({
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiContentAnalysisSchema),
    providerCall: () => contentAnalysisWithProvider(body.content),
    reviewType: "content-analysis",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function analyzeContentWithFallback(body: AiContentBody, target?: AiReviewTarget) {
  return runAiWithFallback<AiContentAnalysis>({
    fallbackCall: () => contentAnalysisFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiContentAnalysisSchema),
    providerCall: () => contentAnalysisWithProvider(body.content),
    reviewType: "content-analysis",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function summarizeMonthlyRecapWithFallback(
  body: AiContentBody,
  target?: AiReviewTarget,
) {
  return runAiWithFallback<AiMonthlyRecap>({
    fallbackCall: () => monthlyRecapFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiMonthlyRecapSchema),
    providerCall: () => monthlyRecapWithProvider(body.content),
    reviewType: "monthly-recap",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function suggestEcho(body: AiContentBody, target?: AiReviewTarget) {
  return runAi<AiEchoSuggestion>({
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiEchoSuggestionSchema),
    providerCall: () => echoSuggestionWithProvider(body.content),
    reviewType: "echo-suggestion",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function suggestEchoWithFallback(body: AiContentBody, target?: AiReviewTarget) {
  return runAiWithFallback<AiEchoSuggestion>({
    fallbackCall: () => echoFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiEchoSuggestionSchema),
    providerCall: () => echoSuggestionWithProvider(body.content),
    reviewType: "echo-suggestion",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function generateSignalFingerprintWithFallback(
  body: AiContentBody,
  target?: AiReviewTarget,
) {
  return runAiWithFallback({
    fallbackCall: () => signalFingerprintFallback(body.content),
    inputText: body.content,
    parse: (value) => parseAiResult(value, aiSignalFingerprintSchema),
    providerCall: () => signalFingerprintWithProvider(body.content),
    reviewType: "signal-fingerprint",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function generateSignalProgramWithFallback(
  input: AiSignalProgramInput,
  target?: AiReviewTarget,
) {
  const inputText = JSON.stringify(input);

  return runAiWithFallback({
    fallbackCall: () => signalProgramFallback(input),
    inputText,
    parse: (value) => parseAiResult(value, aiSignalProgramSchema),
    providerCall: () => signalProgramWithProvider(input),
    reviewType: "signal-program",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function generateSignalExpansionWithFallback(
  input: AiSignalExpansionInput,
  target?: AiReviewTarget,
  options: {
    skipDirectionReview?: boolean;
  } = {},
) {
  const inputText = JSON.stringify(input);

  return runAi<AiSignalExpansion>({
    inputText,
    parse: (value) => {
      const expansion = parseAiResult(value, aiSignalExpansionSchema);

      if (options.skipDirectionReview === true) {
        return expansion;
      }

      const review = signalExpansionReviewFallback({
        classification: input.classification,
        expandedText: expansion.expandedText,
        seedText: input.seedText,
      });

      if (!review.pass) {
        throw new AppError("AI_UNAVAILABLE", "AI provider returned off-direction expansion.");
      }

      return expansion;
    },
    providerCall: () => signalExpansionWithProvider(input),
    reviewType: "signal-expansion",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function generateSignalMaterial(
  input: AiContentBody,
  target?: AiReviewTarget,
) {
  return runAi<AiSignalMaterial>({
    inputText: input.content,
    parse: (value) => parseAiResult(value, aiSignalMaterialSchema),
    providerCall: () => signalMaterialWithProvider(input.content),
    reviewType: "signal-material",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function analyzeSignalIntentWithFallback(
  input: AiContentBody,
  target?: AiReviewTarget,
) {
  return runAiWithFallback<AiSignalSeedClassification>({
    fallbackCall: () => classifySignalSeedFallback(input.content),
    inputText: input.content,
    parse: (value) => parseAiResult(value, aiSignalSeedClassificationSchema),
    providerCall: () => signalIntentAnalysisWithProvider(input.content),
    reviewType: "signal-intent-analysis",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function classifySignalSeedWithFallback(
  input: AiContentBody,
  target?: AiReviewTarget,
) {
  return runAiWithFallback<AiSignalSeedClassification>({
    fallbackCall: () => classifySignalSeedFallback(input.content),
    inputText: input.content,
    parse: (value) => parseAiResult(value, aiSignalSeedClassificationSchema),
    providerCall: () => signalSeedClassificationWithProvider(input.content),
    reviewType: "signal-seed-classification",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function reviewSignalExpansionWithFallback(
  input: AiSignalExpansionReviewInput,
  target?: AiReviewTarget,
) {
  const inputText = JSON.stringify(input);

  return runAiWithFallback<AiSignalExpansionReview>({
    fallbackCall: () => signalExpansionReviewFallback(input),
    inputText,
    parse: (value) => parseAiResult(value, aiSignalExpansionReviewSchema),
    providerCall: () => signalExpansionReviewWithProvider(input),
    reviewType: "signal-expansion-review",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function generateSignalContentWithFallback(
  input: AiSignalContentInput,
  target?: AiReviewTarget,
) {
  const inputText = JSON.stringify(input);

  return runAiWithFallback<AiSignalContent>({
    fallbackCall: () => signalContentFallback(input),
    inputText,
    parse: (value) => parseAiResult(value, aiSignalContentSchema),
    providerCall: () => signalContentWithProvider(input),
    reviewType: "signal-content",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}

export async function scoreSignalQualityWithFallback(
  input: AiSignalQualityInput,
  target?: AiReviewTarget,
) {
  const inputText = JSON.stringify(input);

  return runAiWithFallback<AiSignalQuality>({
    fallbackCall: () => signalQualityFallback(input),
    inputText,
    parse: (value) => parseAiResult(value, aiSignalQualitySchema),
    providerCall: () => signalQualityWithProvider(input),
    reviewType: "signal-quality",
    targetId: target?.targetId,
    targetType: target?.targetType,
  });
}
