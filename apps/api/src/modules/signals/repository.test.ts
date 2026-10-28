import { describe, expect, it, vi } from "vitest";
import { db } from "../../db/client.js";
import { signalResonances } from "../../db/schema.js";
import { summarizeSignalResonancesSince } from "./repository.js";

const drizzleCalls = vi.hoisted(() => {
  const orderBy = vi.fn(() => []);
  const groupBy = vi.fn(() => ({ orderBy }));
  const where = vi.fn(() => ({ groupBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    from,
    groupBy,
    innerJoin,
    orderBy,
    select,
    where,
  };
});

const drizzleConditions = vi.hoisted(() => {
  return {
    gt: [] as Array<{ column: unknown; value: unknown }>,
    rawSqlValues: [] as unknown[],
  };
});

vi.mock("drizzle-orm", () => {
  return {
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
    asc: vi.fn((column: unknown) => ({ column, type: "asc" })),
    desc: vi.fn((column: unknown) => ({ column, type: "desc" })),
    eq: vi.fn((column: unknown, value: unknown) => ({ column, type: "eq", value })),
    gt: vi.fn((column: unknown, value: unknown) => {
      drizzleConditions.gt.push({ column, value });

      return { column, type: "gt", value };
    }),
    inArray: vi.fn((column: unknown, values: unknown[]) => ({ column, type: "inArray", values })),
    isNotNull: vi.fn((column: unknown) => ({ column, type: "isNotNull" })),
    isNull: vi.fn((column: unknown) => ({ column, type: "isNull" })),
    ne: vi.fn((column: unknown, value: unknown) => ({ column, type: "ne", value })),
    sql: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      drizzleConditions.rawSqlValues.push(...values);

      return {
        mapWith: vi.fn(() => ({ type: "sql", values })),
        type: "sql",
        values,
      };
    }),
  };
});

vi.mock("../../db/client.js", () => {
  return {
    db: {
      select: drizzleCalls.select,
    },
  };
});

describe("signal repository", () => {
  it("uses typed timestamp comparison for echo-summary resonance watermarks", async () => {
    const since = new Date("2026-05-10T00:00:00.000Z");

    await summarizeSignalResonancesSince({
      authorId: "00000000-0000-4000-8000-000000000301",
      since,
    });

    expect(db.select).toHaveBeenCalled();
    expect(drizzleConditions.gt).toContainEqual({
      column: signalResonances.createdAt,
      value: since,
    });
    expect(drizzleConditions.rawSqlValues).not.toContain(since);
  });
});
