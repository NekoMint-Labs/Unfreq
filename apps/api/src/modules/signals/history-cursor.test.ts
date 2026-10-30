import { describe, expect, it } from "vitest";
import { decodeHistoryCursor, encodeHistoryCursor } from "./history-cursor.js";
describe("private history cursor", () => {
  it("retains microseconds instead of rounding a boundary to milliseconds", () => {
    const value = { createdAt: "2029-01-01T00:00:00.123456Z", id: "d4000000-0000-4000-8000-000000000001" };
    expect(decodeHistoryCursor(encodeHistoryCursor(value))).toEqual(value);
  });
  it("rejects corrupt, noncanonical and unsupported cursor payloads", () => {
    for (const value of ["invalid", "!", "a".repeat(257), Buffer.from(JSON.stringify([2, "2029-01-01T00:00:00.123456Z", "id"])).toString("base64url"),
      encodeHistoryCursor({ createdAt: "2029-02-30T00:00:00.123456Z", id: "d4000000-0000-4000-8000-000000000001" }),
      encodeHistoryCursor({ createdAt: "2029-01-01T00:00:00.123Z", id: "d4000000-0000-4000-8000-000000000001" }),
      encodeHistoryCursor({ createdAt: "0000-01-01T00:00:00.123456Z", id: "d4000000-0000-4000-8000-000000000001" }),
      encodeHistoryCursor({ createdAt: "2029-01-01T00:00:00.123456Z", id: "not-a-uuid" })]) expect(decodeHistoryCursor(value)).toBeUndefined();
  });
});
