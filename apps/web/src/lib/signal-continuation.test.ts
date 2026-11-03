import { describe, expect, it } from "vitest";
import { normalizeContinuation, parseContinuation } from "./signal-continuation";

const parent = "D4000000-0000-4000-8000-000000000002";
describe("tab-local continuation data", () => {
  it("preserves the seed and canonical parent without storing navigation targets", () => {
    expect(parseContinuation(JSON.stringify({ seedText: "合成续写内容", parentSignalId: parent, returnTo: "https://evil.example" })))
      .toEqual({ seedText: "合成续写内容", parentSignalId: parent.toLowerCase() });
  });
  it("rejects corrupt, oversized and invalid parent records", () => {
    for (const value of [null, "{", "[]", "null", JSON.stringify({ seedText: "a".repeat(201) }), JSON.stringify({ seedText: "正常", parentSignalId: "https://evil.example" })]) {
      expect(parseContinuation(value)).toBeUndefined();
    }
  });
  it("bounds old URL inputs without truncating private content into a different seed", () => {
    expect(normalizeContinuation(["bad"], "invalid")).toEqual({ seedText: "" });
    expect(normalizeContinuation("a".repeat(201), parent)).toEqual({ seedText: "", parentSignalId: parent.toLowerCase() });
  });
});
