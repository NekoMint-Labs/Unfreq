import { defineConfig } from "playwright/test";
import runtime from "../../playwright.runtime.config";

if (!Array.isArray(runtime.webServer) || runtime.webServer.length !== 2) {
  throw new Error("The image regression requires the existing owned mock and Web servers.");
}

export default defineConfig({
  ...runtime,
  testDir: "../e2e/runtime",
  outputDir: "../../test-results/runtime",
  webServer: [
    { ...runtime.webServer[0], cwd: process.cwd() },
    {
      ...runtime.webServer[1],
      command: "node tests/dependencies/start-web-image.mjs",
      cwd: process.cwd(),
      name: "high-dependency-web-image",
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
  ],
});
