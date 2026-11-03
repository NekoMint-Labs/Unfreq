import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { createGuestUser, createPasswordFrequencyUser, createUser, updateUserFrequencyCredentials } from "./repository.js";
import type { AuthUserRecord } from "./types.js";

const database = vi.hoisted(() => ({
  transaction: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn(), select: vi.fn(),
}));
vi.mock("../../db/client.js", () => ({ db: database }));
const user: AuthUserRecord = {
  id: "00000000-0000-4000-8000-000000000111", freqCode: "FM 11.11", email: "synthetic@example.invalid",
  frequencyName: "synthetic", passwordHash: "SYNTHETIC-PASSWORD-HASH", isGuest: false,
  role: "USER", status: "ACTIVE", createdAt: new Date("2026-10-31T00:00:00.123Z"), updatedAt: new Date("2026-10-31T00:00:00.123Z"),
};
const transaction = { insert: vi.fn(), update: vi.fn(), select: vi.fn(), execute: vi.fn() };
const insertion = { values: vi.fn(), onConflictDoNothing: vi.fn(), returning: vi.fn() };
const update = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
const lock = vi.fn();
const writers = [
  { name: "email registration", run: () => createUser({ email: user.email!, freqCode: user.freqCode }) },
  { name: "guest registration", run: () => createGuestUser({ freqCode: user.freqCode }) },
  { name: "password registration", run: () => createPasswordFrequencyUser({ freqCode: user.freqCode, passwordHash: user.passwordHash! }) },
  { name: "credential update", run: () => updateUserFrequencyCredentials({ userId: user.id, frequencyName: user.frequencyName!, passwordHash: user.passwordHash! }) },
];

beforeEach(() => {
  vi.resetAllMocks();
  database.transaction.mockImplementation((run: (tx: typeof transaction) => Promise<unknown>) => run(transaction));
  for (const operation of [database.insert, database.update, database.execute, database.select]) {
    operation.mockImplementation(() => { throw new Error("Identity operation escaped its transaction."); });
  }
  transaction.insert.mockReturnValue(insertion);
  insertion.values.mockReturnValue(insertion);
  insertion.onConflictDoNothing.mockReturnValue(insertion);
  insertion.returning.mockResolvedValue([user]);
  transaction.update.mockReturnValue(update);
  update.set.mockReturnValue(update);
  update.where.mockReturnValue(update);
  update.returning.mockResolvedValue([user]);
  lock.mockResolvedValue([user]);
  transaction.select.mockReturnValue({ from: () => ({ where: () => ({ limit: () => ({ for: lock }) }) }) });
  transaction.execute.mockResolvedValue([]);
});

describe("authoritative identity writes", () => {
  it.each(writers)("keeps $name and its mirror on one transaction", async ({ run }) => {
    expect(await run()).toEqual(user);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(transaction.execute).toHaveBeenCalledTimes(1);
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
    expect(database.execute).not.toHaveBeenCalled();
  });
  it.each(writers)("propagates the mirror failure before $name can succeed", async ({ run }) => {
    const failure = new Error("Synthetic second-write fault.");
    transaction.execute.mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });
  it("locks an email conflict's authoritative row inside the same transaction", async () => {
    insertion.returning.mockResolvedValue([]);
    expect(await writers[0]!.run()).toEqual(user);
    expect(transaction.select).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith("update");
    expect(database.select).not.toHaveBeenCalled();
  });
  it("does not create a mirror when no authoritative row was updated", async () => {
    update.returning.mockResolvedValue([]);
    expect(await writers[3]!.run()).toBeUndefined();
    expect(transaction.execute).not.toHaveBeenCalled();
  });
  it("rejects a missing conflict row instead of creating an orphan", async () => {
    insertion.returning.mockResolvedValue([]);
    lock.mockResolvedValue([]);
    await expect(writers[0]!.run()).rejects.toThrow("User insert returned no row");
    expect(transaction.execute).not.toHaveBeenCalled();
  });
  it("copies timestamp and permission values in PostgreSQL without JS Date parameters", async () => {
    await writers[2]!.run();
    const query = new PgDialect().sqlToQuery(transaction.execute.mock.calls[0]![0] as SQL);
    expect(query.sql).toMatch(/select id, freq_code/u);
    expect(query.sql).toContain("status::text::frequency_status");
    expect(query.sql).toContain("created_at = excluded.created_at");
    expect(query.sql).toContain("updated_at = excluded.updated_at");
    expect(query.params).toEqual([user.id]);
    expect(query.sql).not.toMatch(/last_seen_at|device_hash/u);
  });
});
