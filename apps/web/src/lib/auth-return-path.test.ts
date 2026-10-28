import { describe, expect, it } from "vitest";
import { getAuthSuccessPath, sanitizeAuthReturnPath } from "./auth-return-path";

describe("auth return path helpers", () => {
  it("keeps safe internal return paths", () => {
    expect(sanitizeAuthReturnPath("/?onboarding=seed")).toBe("/?onboarding=seed");
    expect(sanitizeAuthReturnPath("/result/signal-1?from=home#signal")).toBe(
      "/result/signal-1?from=home#signal",
    );
  });

  it("drops ambiguous or external return paths", () => {
    expect(sanitizeAuthReturnPath(undefined)).toBeUndefined();
    expect(sanitizeAuthReturnPath("")).toBeUndefined();
    expect(sanitizeAuthReturnPath("   ")).toBeUndefined();
    expect(sanitizeAuthReturnPath(["/?onboarding=seed"])).toBeUndefined();
    expect(sanitizeAuthReturnPath("me?onboarding=login")).toBeUndefined();
    expect(sanitizeAuthReturnPath("https://evil.example/path")).toBeUndefined();
    expect(sanitizeAuthReturnPath("//evil.example/path")).toBeUndefined();
    expect(sanitizeAuthReturnPath("/\\evil.example/path")).toBeUndefined();
    expect(sanitizeAuthReturnPath("javascript:alert(1)")).toBeUndefined();
  });

  it("falls back to bounded onboarding destinations", () => {
    expect(getAuthSuccessPath("/?onboarding=seed", "login")).toBe("/?onboarding=seed");
    expect(getAuthSuccessPath("https://evil.example/path", "login")).toBe(
      "/me?onboarding=login",
    );
    expect(getAuthSuccessPath(undefined, "registration")).toBe(
      "/me?onboarding=registered",
    );
  });
});
