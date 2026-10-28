import { describe, expect, it, vi } from "vitest";
import { db } from "../../db/client.js";
import { findCurrentThemeRadioDay } from "./repository.js";

const capturedSqlParams = vi.hoisted(() => {
  return {
    params: [] as unknown[],
  };
});

vi.mock("drizzle-orm", () => {
  return {
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
    desc: vi.fn((column: unknown) => ({ column, type: "desc" })),
    eq: vi.fn((column: unknown, value: unknown) => ({ column, type: "eq", value })),
    isNull: vi.fn((column: unknown) => ({ column, type: "isNull" })),
    or: vi.fn((...conditions: unknown[]) => ({ conditions, type: "or" })),
    sql: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedSqlParams.params.push(
        ...values.filter((value) => {
          return typeof value === "string" || value instanceof Date;
        }),
      );

      return { type: "sql", values };
    }),
  };
});

vi.mock("../../db/client.js", () => {
  const chain = {
    from: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([])),
    orderBy: vi.fn(() => chain),
    where: vi.fn(() => chain),
  };

  return {
    db: {
      select: vi.fn(() => chain),
    },
  };
});

describe("theme radio repository", () => {
  it("serializes current-time filters before passing them into raw SQL", async () => {
    await findCurrentThemeRadioDay(new Date("2026-05-10T12:00:00.000Z"));

    expect(db.select).toHaveBeenCalled();
    expect(capturedSqlParams.params).toEqual([
      "2026-05-10T12:00:00.000Z",
      "2026-05-10T12:00:00.000Z",
    ]);
  });
});
