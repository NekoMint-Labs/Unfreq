import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GalaxyGeneratedTime } from "./GalaxyGeneratedTime";

const generatedAt = "2026-10-28T00:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Galaxy generation time before browser hydration", () => {
  it.each([
    ["UTC", "00:00"],
    ["Asia/Shanghai", "08:00"],
    ["America/New_York", "20:00"],
  ])("renders the same actual SSR placeholder in %s", (timezone, localTime) => {
    vi.stubEnv("TZ", timezone);
    expect(new Date(generatedAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit", minute: "2-digit",
    })).toBe(localTime);
    // Locale formatting must not run during SSR. The browser alone knows
    // which local time it should show after hydration.
    const formatter = vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(() => {
      throw new Error("SSR attempted browser-local time formatting");
    });
    const html = renderToString(createElement(GalaxyGeneratedTime, { generatedAt }));
    expect(html).toBe(`<time dateTime="${generatedAt}">--:--</time>`);
    expect(formatter).not.toHaveBeenCalled();
  });

  it("keeps the exact instant in SSR markup when the generated data changes", () => {
    const nextGeneratedAt = "2026-10-28T23:59:00.000Z";
    const html = renderToString(createElement(GalaxyGeneratedTime, { generatedAt: nextGeneratedAt }));
    expect(html).toBe(`<time dateTime="${nextGeneratedAt}">--:--</time>`);
  });
});
