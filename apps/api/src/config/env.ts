import "dotenv/config";
import { z } from "zod";

const defaultSessionSecret = "local-dev-session-secret-change-before-production";

const envSchema = z.object({
  AUTH_LOGIN_CHALLENGE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(60 * 60)
    .default(10 * 60),
  AUTH_LOGIN_CODE_RESPONSE: z.enum(["disabled", "enabled"]).optional(),
  AUTH_LOGIN_DELIVERY_MODE: z.enum(["local-log"]).default("local-log"),
  AUTH_LOGIN_MAX_VERIFY_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5),
  AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(15 * 60)
    .default(60),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  AI_API_KEY: z.string().default(""),
  AI_BASE_URL: z.union([z.string().url(), z.literal("")]).default(""),
  AI_FAST_API_KEY: z.string().default(""),
  AI_FAST_BASE_URL: z.union([z.string().url(), z.literal("")]).default(""),
  AI_FAST_MODEL: z.string().default(""),
  AI_FAST_PROVIDER: z.string().default(""),
  AI_MODEL: z.string().min(1).default("local-fallback"),
  AI_PROVIDER: z.string().min(1).default("openai-compatible"),
  EMBEDDING_API_KEY: z.string().default(""),
  EMBEDDING_BASE_URL: z.union([z.string().url(), z.literal("")]).default(""),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(4096).default(1024),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-v3"),
  EMBEDDING_PROVIDER: z.string().min(1).default("dashscope"),
  EMBEDDING_VERSION: z.string().min(1).default("v1"),
  TTS_API_KEY: z.string().default(""),
  TTS_BASE_URL: z.union([z.string().url(), z.literal("")]).default(""),
  TTS_MODEL: z.string().min(1).default("cosyvoice-v3-flash"),
  TTS_PROVIDER: z.string().min(1).default("dashscope"),
  TTS_STORAGE_DIR: z.string().min(1).default("storage/audio/programs"),
  TTS_VOICE_LEFT: z.string().min(1).default("longxiaochun"),
  TTS_VOICE_RIGHT: z.string().min(1).default("longcheng"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://postgres:postgres@127.0.0.1:5432/unfreq"),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  HEALTH_DEPENDENCY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(10_000)
    .default(1500),
  IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  IMAGE_STORAGE_DIR: z.string().min(1).default("storage/images"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  PROVIDER_CONFIG_SECRET: z.string().default(""),
  RERANKER_API_KEY: z.string().default(""),
  RERANKER_BASE_URL: z.union([z.string().url(), z.literal("")]).default(""),
  RERANKER_MODEL: z.string().min(1).default("local-disabled"),
  RERANKER_PROVIDER: z.string().min(1).default("disabled"),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default(defaultSessionSecret),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid API environment: ${details}`);
}

if (
  parsedEnv.data.NODE_ENV === "production" &&
  parsedEnv.data.SESSION_SECRET === defaultSessionSecret
) {
  throw new Error("Invalid API environment: SESSION_SECRET must be set in production.");
}

const isPlaceholderSecret = (value: string) => {
  return (
    value.length < 32 ||
    value.startsWith("replace-") ||
    value.includes("replace-this") ||
    value.includes("change-before-production")
  );
};

const isPlaceholderOrigin = (value: string) => {
  return value.includes("your-domain.example") || value.includes("localhost");
};

if (parsedEnv.data.NODE_ENV === "production") {
  if (isPlaceholderSecret(parsedEnv.data.SESSION_SECRET)) {
    throw new Error(
      "Invalid API environment: SESSION_SECRET must be a non-placeholder production secret.",
    );
  }

  if (isPlaceholderSecret(parsedEnv.data.PROVIDER_CONFIG_SECRET)) {
    throw new Error(
      "Invalid API environment: PROVIDER_CONFIG_SECRET must be a non-placeholder production secret.",
    );
  }

  if (
    !parsedEnv.data.WEB_ORIGIN.startsWith("https://") ||
    isPlaceholderOrigin(parsedEnv.data.WEB_ORIGIN)
  ) {
    throw new Error(
      "Invalid API environment: WEB_ORIGIN must be a real https:// production URL.",
    );
  }
}

const authLoginCodeResponse =
  parsedEnv.data.AUTH_LOGIN_CODE_RESPONSE ??
  (parsedEnv.data.NODE_ENV === "production" ? "disabled" : "enabled");

export const env = {
  authLoginChallengeTtlSeconds: parsedEnv.data.AUTH_LOGIN_CHALLENGE_TTL_SECONDS,
  authLoginCodeResponseEnabled: authLoginCodeResponse === "enabled",
  authLoginDeliveryMode: parsedEnv.data.AUTH_LOGIN_DELIVERY_MODE,
  authLoginMaxVerifyAttempts: parsedEnv.data.AUTH_LOGIN_MAX_VERIFY_ATTEMPTS,
  authLoginRequestCooldownSeconds:
    parsedEnv.data.AUTH_LOGIN_REQUEST_COOLDOWN_SECONDS,
  aiApiKey: parsedEnv.data.AI_API_KEY,
  aiBaseUrl: parsedEnv.data.AI_BASE_URL,
  aiFastApiKey: parsedEnv.data.AI_FAST_API_KEY,
  aiFastBaseUrl: parsedEnv.data.AI_FAST_BASE_URL,
  aiFastModel: parsedEnv.data.AI_FAST_MODEL,
  aiFastProvider: parsedEnv.data.AI_FAST_PROVIDER,
  aiModel: parsedEnv.data.AI_MODEL,
  aiProvider: parsedEnv.data.AI_PROVIDER,
  embeddingApiKey: parsedEnv.data.EMBEDDING_API_KEY,
  embeddingBaseUrl: parsedEnv.data.EMBEDDING_BASE_URL,
  embeddingDimensions: parsedEnv.data.EMBEDDING_DIMENSIONS,
  embeddingModel: parsedEnv.data.EMBEDDING_MODEL,
  embeddingProvider: parsedEnv.data.EMBEDDING_PROVIDER,
  embeddingVersion: parsedEnv.data.EMBEDDING_VERSION,
  ttsApiKey: parsedEnv.data.TTS_API_KEY,
  ttsBaseUrl: parsedEnv.data.TTS_BASE_URL,
  ttsModel: parsedEnv.data.TTS_MODEL,
  ttsProvider: parsedEnv.data.TTS_PROVIDER,
  ttsStorageDir: parsedEnv.data.TTS_STORAGE_DIR,
  ttsVoiceLeft: parsedEnv.data.TTS_VOICE_LEFT,
  ttsVoiceRight: parsedEnv.data.TTS_VOICE_RIGHT,
  apiHost: parsedEnv.data.API_HOST,
  apiPort: parsedEnv.data.API_PORT,
  databaseUrl: parsedEnv.data.DATABASE_URL,
  dbPoolMax: parsedEnv.data.DB_POOL_MAX,
  healthDependencyTimeoutMs: parsedEnv.data.HEALTH_DEPENDENCY_TIMEOUT_MS,
  imageMaxBytes: parsedEnv.data.IMAGE_MAX_BYTES,
  imageStorageDir: parsedEnv.data.IMAGE_STORAGE_DIR,
  isProduction: parsedEnv.data.NODE_ENV === "production",
  isTest: parsedEnv.data.NODE_ENV === "test",
  logLevel: parsedEnv.data.LOG_LEVEL,
  redisUrl: parsedEnv.data.REDIS_URL,
  providerConfigSecret: parsedEnv.data.PROVIDER_CONFIG_SECRET,
  rerankerApiKey: parsedEnv.data.RERANKER_API_KEY,
  rerankerBaseUrl: parsedEnv.data.RERANKER_BASE_URL,
  rerankerModel: parsedEnv.data.RERANKER_MODEL,
  rerankerProvider: parsedEnv.data.RERANKER_PROVIDER,
  sessionSecret: parsedEnv.data.SESSION_SECRET,
  webOrigin: parsedEnv.data.WEB_ORIGIN,
} as const;
