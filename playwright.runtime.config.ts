import { defineConfig, devices } from "playwright/test";

const webPort = Number(process.env.RUNTIME_WEB_PORT ?? 3200);
const apiPort = Number(process.env.RUNTIME_API_PORT ?? 4200);
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

// Build first with NEXT_PUBLIC_API_BASE_URL set to this same synthetic API URL.
export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "test-results/runtime",
  projects: [{ name: "chromium-production", use: { ...devices["Desktop Chrome"] } }],
  reporter: process.env.CI === "true" ? "github" : "list",
  testDir: "tests/e2e/runtime",
  testMatch: "production.spec.ts",
  timeout: 60_000,
  use: { baseURL: webBaseUrl, trace: "retain-on-failure" },
  workers: 1,
  webServer: [
    {
      command: "node tests/e2e/runtime/mock-api.mjs",
      env: {
        RUNTIME_API_PORT: String(apiPort),
        RUNTIME_WEB_ORIGIN: webBaseUrl,
      },
      name: "runtime-synthetic-api",
      port: apiPort,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port ${webPort}`,
      env: {
        API_INTERNAL_BASE_URL: apiBaseUrl,
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
      },
      name: "next-production-runtime",
      port: webPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
