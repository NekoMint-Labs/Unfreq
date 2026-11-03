import { describe, expect, it } from "vitest";
import { galaxyHref } from "./galaxy-navigation";

describe("Galaxy navigation", () => {
  it("preserves legitimate filters and an encoded signal selection", () => {
    expect(galaxyHref()).toBe("/galaxy");
    expect(galaxyHref({ band: "self_mirror", focus: "one/two", theme: "ignored" })).toBe("/galaxy?band=self_mirror&focus=one%2Ftwo");
    expect(galaxyHref({ theme: "关系星云" })).toBe("/galaxy?theme=%E5%85%B3%E7%B3%BB%E6%98%9F%E4%BA%91");
  });
});
