import { defineConfig, devices } from "playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 4100);
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: "test-results/e2e",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  reporter: process.env.CI === "true" ? "github" : "list",
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/mock-api.mjs",
      env: {
        E2E_API_PORT: String(apiPort),
        E2E_WEB_ORIGIN: webBaseUrl,
      },
      name: "e2e-api",
      port: apiPort,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node_modules/.bin/next dev apps/web --hostname 127.0.0.1 --port ${webPort}`,
      env: {
        API_INTERNAL_BASE_URL: apiBaseUrl,
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
        NODE_ENV: "test",
      },
      name: "web",
      port: webPort,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
