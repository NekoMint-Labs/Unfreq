import { defineConfig } from "playwright/test";
import runtime from "./playwright.runtime.config";

if (!Array.isArray(runtime.webServer) || runtime.webServer.length !== 2) {
  throw new Error("The image regression requires the existing owned mock and Web servers.");
}

export default defineConfig({
  ...runtime,
  webServer: [
    runtime.webServer[0],
    {
      ...runtime.webServer[1],
      command: "node tests/e2e/runtime/start-web-image.mjs",
      name: "linux-web-image",
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
  ],
});
