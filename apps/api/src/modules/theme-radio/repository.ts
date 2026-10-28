import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { themeRadioDays } from "../../db/schema.js";
import type { ThemeRadioDayInput, ThemeRadioDayRecord } from "./types.js";

function toThemeRadioDayRecord(row: typeof themeRadioDays.$inferSelect): ThemeRadioDayRecord {
  return {
    createdAt: row.createdAt,
    description: row.description,
    endsAt: row.endsAt,
    id: row.id,
    isActive: row.isActive,
    startsAt: row.startsAt,
    theme: row.theme,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

export async function findCurrentThemeRadioDay(
  now = new Date(),
): Promise<ThemeRadioDayRecord | undefined> {
  const nowIso = now.toISOString();

  const [row] = await db
    .select()
    .from(themeRadioDays)
    .where(
      and(
        eq(themeRadioDays.isActive, true),
        sql`${themeRadioDays.startsAt} <= ${nowIso}`,
        or(isNull(themeRadioDays.endsAt), sql`${themeRadioDays.endsAt} > ${nowIso}`),
      ),
    )
    .orderBy(desc(themeRadioDays.startsAt))
    .limit(1);

  return row === undefined ? undefined : toThemeRadioDayRecord(row);
}

export async function listThemeRadioDays(limit: number): Promise<ThemeRadioDayRecord[]> {
  const rows = await db
    .select()
    .from(themeRadioDays)
    .orderBy(desc(themeRadioDays.startsAt))
    .limit(limit);

  return rows.map(toThemeRadioDayRecord);
}

export async function createThemeRadioDay(
  input: ThemeRadioDayInput,
): Promise<ThemeRadioDayRecord> {
  const [row] = await db
    .insert(themeRadioDays)
    .values({
      description: input.description,
      endsAt: input.endsAt === undefined ? null : new Date(input.endsAt),
      startsAt: input.startsAt === undefined ? new Date() : new Date(input.startsAt),
      theme: input.theme,
      title: input.title,
      updatedAt: new Date(),
    })
    .returning();

  if (row === undefined) {
    throw new Error("Theme radio day insert returned no row.");
  }

  return toThemeRadioDayRecord(row);
}
