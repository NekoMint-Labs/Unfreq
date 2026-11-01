import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Bound cold Fastify/TypeScript startup contention without relaxing timeouts.
    maxWorkers: 2,
    env: {
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: ".unfreq-unit-tests-no-env",
      DATABASE_URL: "postgres://unit:unit@127.0.0.1:1/unfreq_unit_disabled",
      REDIS_URL: "redis://127.0.0.1:1",
      SESSION_SECRET: "unit-session-secret-not-for-production",
      PROVIDER_CONFIG_SECRET: "unit-provider-secret-not-for-production",
      WEB_ORIGIN: "http://127.0.0.1:3300",
      AI_API_KEY: "",
      AI_BASE_URL: "",
      AI_MODEL: "local-fallback",
      AI_PROVIDER: "openai-compatible",
      AI_FAST_API_KEY: "",
      AI_FAST_BASE_URL: "",
      AI_FAST_MODEL: "",
      AI_FAST_PROVIDER: "",
      EMBEDDING_API_KEY: "",
      EMBEDDING_BASE_URL: "",
      RERANKER_API_KEY: "",
      RERANKER_BASE_URL: "",
      RERANKER_PROVIDER: "disabled",
      TTS_API_KEY: "",
      TTS_BASE_URL: "",
    },
  },
});
