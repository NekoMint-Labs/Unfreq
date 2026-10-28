import { describe, expect, it } from "vitest";
import { extractChatCompletionContent, parseProviderJson, readProviderJson } from "./provider-response.js";

describe("provider response helpers", () => {
  it("extracts and parses chat completion JSON content", () => {
    const payload = {
      choices: [
        {
          message: {
            content: "{\"ok\":true}",
          },
        },
      ],
    };

    expect(readProviderJson<{ ok: boolean }>(payload, "classify")).toEqual({ ok: true });
  });

  it("marks missing chat content as an invalid provider response", () => {
    expect(() => extractChatCompletionContent({ choices: [] }, "classify")).toThrowError(
      expect.objectContaining({
        code: "AI_UNAVAILABLE",
        details: {
          boundary: "provider_call",
          kind: "invalid_response",
          type: "classify",
        },
      }),
    );
  });

  it("marks non-JSON chat content as invalid JSON", () => {
    expect(() => parseProviderJson("not json", "classify")).toThrowError(
      expect.objectContaining({
        code: "AI_UNAVAILABLE",
        details: {
          boundary: "provider_call",
          kind: "invalid_json",
          type: "classify",
        },
      }),
    );
  });
});
