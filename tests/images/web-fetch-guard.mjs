import { appendFileSync } from "node:fs";

// Test-only, enabled through NODE_OPTIONS in the isolated final image.
// Block before sending any URL, text, credentials or glyph request externally.
export function createWebImageFetchGuard(original, recordBlocked = () =>
  appendFileSync("/tmp/unfreq-web-image-blocked-fetch", "blocked\n")) {
  return async (input, options) => {
    let allowed = false;
    try {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      // Next's bundled Yoga uses an inline data: WASM resource, not a network.
      allowed = url.protocol === "data:" || url.origin === "http://127.0.0.1:4200";
    } catch { /* fixed failure below */ }
    if (!allowed) {
      recordBlocked();
      throw new Error("Synthetic image verification blocked external fetch.");
    }
    // Native fetch follows redirects without re-entering this wrapper. Force
    // refusal even when Request or options explicitly asks to follow them.
    return original(input, { ...options, redirect: "error" });
  };
}

globalThis.fetch = createWebImageFetchGuard(globalThis.fetch);
