import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    pool: "forks",
    isolate: true,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    reporters: ["default", "json"],
    outputFile: {
      json: process.env.UNFREQ_INTEGRATION_REPORT ?? "../../test-results/integration/latest.json",
    },
  },
});
