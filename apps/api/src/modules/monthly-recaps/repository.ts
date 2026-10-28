import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import { monthlyRecaps, signals } from "../../db/schema.js";
import type { MonthlyRecapRecord, MonthlyRecapSignal } from "./types.js";

function toMonthlyRecapRecord(row: typeof monthlyRecaps.$inferSelect): MonthlyRecapRecord {
  return {
    createdAt: row.createdAt,
    frequencyId: row.frequencyId,
    generatedAt: row.generatedAt,
    id: row.id,
    signalCount: row.signalCount,
    summary: row.summary,
    themeWords: row.themeWords,
    topSignalId: row.topSignalId,
    totalResonanceCount: row.totalResonanceCount,
    updatedAt: row.updatedAt,
    yearMonth: row.yearMonth,
  };
}

export async function listMonthlyRecapSignals(params: {
  endAt: Date;
  frequencyId: string;
  startAt: Date;
}): Promise<MonthlyRecapSignal[]> {
  const rows = await db
    .select({
      createdAt: signals.createdAt,
      expandedText: signals.expandedText,
      fingerprintJson: signals.fingerprintJson,
      id: signals.id,
      parentSignalId: signals.parentSignalId,
      resonanceCount: signals.resonanceCount,
      seedText: signals.seedText,
      status: signals.status,
    })
    .from(signals)
    .where(
      and(
        eq(signals.frequencyId, params.frequencyId),
        eq(signals.status, "PUBLISHED"),
        gte(signals.createdAt, params.startAt),
        lt(signals.createdAt, params.endAt),
      ),
    )
    .orderBy(desc(signals.createdAt));

  return rows.map((row) => {
    return {
      ...row,
      fingerprintJson: row.fingerprintJson as MonthlyRecapSignal["fingerprintJson"],
      status: "PUBLISHED",
    };
  });
}

export async function findMonthlyRecap(params: {
  frequencyId: string;
  yearMonth: string;
}): Promise<MonthlyRecapRecord | undefined> {
  const [row] = await db
    .select()
    .from(monthlyRecaps)
    .where(
      and(
        eq(monthlyRecaps.frequencyId, params.frequencyId),
        eq(monthlyRecaps.yearMonth, params.yearMonth),
      ),
    )
    .limit(1);

  return row === undefined ? undefined : toMonthlyRecapRecord(row);
}

export async function findLatestMonthlyRecap(
  frequencyId: string,
): Promise<MonthlyRecapRecord | undefined> {
  const [row] = await db
    .select()
    .from(monthlyRecaps)
    .where(eq(monthlyRecaps.frequencyId, frequencyId))
    .orderBy(desc(monthlyRecaps.yearMonth))
    .limit(1);

  return row === undefined ? undefined : toMonthlyRecapRecord(row);
}

export async function upsertMonthlyRecap(params: {
  frequencyId: string;
  signalCount: number;
  summary: string;
  themeWords: string[];
  topSignalId?: string;
  totalResonanceCount: number;
  yearMonth: string;
}): Promise<MonthlyRecapRecord> {
  const now = new Date();
  const [row] = await db
    .insert(monthlyRecaps)
    .values({
      frequencyId: params.frequencyId,
      generatedAt: now,
      signalCount: params.signalCount,
      summary: params.summary,
      themeWords: params.themeWords,
      topSignalId: params.topSignalId ?? null,
      totalResonanceCount: params.totalResonanceCount,
      updatedAt: now,
      yearMonth: params.yearMonth,
    })
    .onConflictDoUpdate({
      set: {
        generatedAt: now,
        signalCount: params.signalCount,
        summary: params.summary,
        themeWords: params.themeWords,
        topSignalId: params.topSignalId ?? null,
        totalResonanceCount: params.totalResonanceCount,
        updatedAt: now,
      },
      target: [monthlyRecaps.frequencyId, monthlyRecaps.yearMonth],
    })
    .returning();

  if (row === undefined) {
    throw new Error("Monthly recap upsert returned no row.");
  }

  return toMonthlyRecapRecord(row);
}

export async function findPublishedSignalForMonthlyRecap(params: {
  frequencyId: string;
  signalId: string;
}): Promise<MonthlyRecapSignal | undefined> {
  const [row] = await db
    .select({
      createdAt: signals.createdAt,
      expandedText: signals.expandedText,
      fingerprintJson: signals.fingerprintJson,
      id: signals.id,
      parentSignalId: signals.parentSignalId,
      resonanceCount: signals.resonanceCount,
      seedText: signals.seedText,
      status: signals.status,
    })
    .from(signals)
    .where(
      and(
        eq(signals.id, params.signalId),
        eq(signals.frequencyId, params.frequencyId),
        ne(signals.status, "DELETED"),
      ),
    )
    .limit(1);

  if (row === undefined || row.status !== "PUBLISHED") {
    return undefined;
  }

  return {
    ...row,
    fingerprintJson: row.fingerprintJson as MonthlyRecapSignal["fingerprintJson"],
    status: "PUBLISHED",
  };
}
