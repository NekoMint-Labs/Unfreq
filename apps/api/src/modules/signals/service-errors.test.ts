import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/errors.js";
import { toSafeErrorReason } from "./service-errors.js";

describe("safe signal failure reasons", () => {
  it("retains fixed application codes and known error types without reflecting arbitrary error names or content", () => {
    expect(toSafeErrorReason(new AppError("AI_UNAVAILABLE", "SYNTHETIC_PRIVATE_MESSAGE"))).toBe("AI_UNAVAILABLE");
    expect(toSafeErrorReason(Object.assign(new Error("SYNTHETIC_PRIVATE_MESSAGE"), { name: "PostgresError" }))).toBe("PostgresError");
    expect(toSafeErrorReason(Object.assign(new Error("SYNTHETIC_PRIVATE_MESSAGE"), { name: "SYNTHETIC_PRIVATE_NAME" }))).toBe("Error");
    expect(toSafeErrorReason("SYNTHETIC_PRIVATE_REJECTION")).toBe("Error");
  });
});
