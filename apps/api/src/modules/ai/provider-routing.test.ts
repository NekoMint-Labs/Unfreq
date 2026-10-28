import { describe, expect, it } from "vitest";
import { getAiProviderTimeoutMs, selectChatProviderConfigs } from "./provider-routing.js";
import type { ChatProviderConfig } from "./provider-config.js";

function chatConfig(input: Partial<ChatProviderConfig>): ChatProviderConfig {
  return {
    apiKey: "sk-test",
    baseUrl: "https://chat.example.com/v1",
    model: "example-chat",
    profile: "default",
    provider: "openai-compatible",
    ...input,
  };
}

describe("provider routing helpers", () => {
  it("routes fast judgment calls to fast configs", () => {
    const fast = chatConfig({ model: "fast-chat", profile: "fast" });
    const defaultConfig = chatConfig({ model: "default-chat", profile: "default" });

    expect(selectChatProviderConfigs([defaultConfig, fast], "classify")).toEqual([fast]);
  });

  it("falls back to another profile when the preferred profile is missing", () => {
    const defaultConfig = chatConfig({ model: "default-chat", profile: "default" });

    expect(selectChatProviderConfigs([defaultConfig], "classify")).toEqual([defaultConfig]);
  });

  it("keeps generation and judgment timeout windows separate", () => {
    expect(getAiProviderTimeoutMs("classify")).toBe(10_000);
    expect(getAiProviderTimeoutMs("signal-expansion")).toBe(20_000);
  });
});
