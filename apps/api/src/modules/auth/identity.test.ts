import { describe, expect, it } from "vitest";
import { createFrequencyCodeCandidates, normalizeFrequencyCode } from "./identity.js";

describe("FM identity normalization", () => {
  it.each(["11.11", "FM 11.11", "fm-11.11", " fM--- 11.11 ", "FM\t11.11"])("shares the existing login identity for %j", (input) => {
    expect(normalizeFrequencyCode(input)).toBe("FM 11.11");
    expect(createFrequencyCodeCandidates(input)).toEqual(["FM 11.11", "FM-11.11"]);
  });
  it("preserves the existing suffix rather than inventing numeric aliases", () => {
    expect(normalizeFrequencyCode(" fm-11 .11 ")).toBe("FM 11 .11");
    expect(normalizeFrequencyCode("fm-1.1")).toBe("FM 1.1");
  });
});
