import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api-client";
import { allowsBrowserSpeechFallback } from "./signal-audio-policy";
const failure = (status: number) => new ApiClientError({ status, code: "synthetic", message: "synthetic" });
describe("browser speech visibility policy", () => {
  it.each([401, 403, 404, 409])("does not speak cached text after HTTP %s", (status) => expect(allowsBrowserSpeechFallback(failure(status))).toBe(false));
  it("still permits local fallback for unavailable TTS", () => {
    expect(allowsBrowserSpeechFallback(failure(503))).toBe(true);
    expect(allowsBrowserSpeechFallback(new Error("synthetic network failure"))).toBe(true);
  });
});
