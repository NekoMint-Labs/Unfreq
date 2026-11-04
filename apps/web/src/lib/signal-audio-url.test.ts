import { describe, expect, it } from "vitest";
import { resolveSignalAudioUrl } from "./signal-audio-url";
describe("versioned audio paths", () => {
  it.each(["http://127.0.0.1:4200", "http://127.0.0.1:4200/", "http://127.0.0.1:4200/api"])("uses the configured API host for %s without losing the version", (base) => {
    expect(resolveSignalAudioUrl("/api/signals/synthetic/audio/main?v=3", base)).toBe("http://127.0.0.1:4200/api/signals/synthetic/audio/main?v=3");
  });
  it("supports same-origin API proxies", () => {
    expect(resolveSignalAudioUrl("/api/signals/synthetic/audio/main?v=3", "/api")).toBe("/api/signals/synthetic/audio/main?v=3");
  });
});
