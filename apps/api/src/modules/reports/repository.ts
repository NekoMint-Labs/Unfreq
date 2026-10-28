import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { reports, users } from "../../db/schema.js";
import type { CreateReportBody, ReportStatus } from "./schemas.js";
import type { ReportRecord } from "./types.js";

const reportSelection = {
  createdAt: reports.createdAt,
  id: reports.id,
  note: reports.note,
  reason: reports.reason,
  reporterFreqCode: users.freqCode,
  reporterId: reports.reporterId,
  resolvedAt: reports.resolvedAt,
  resolvedById: reports.resolvedById,
  resolution: reports.resolution,
  status: reports.status,
  targetId: reports.targetId,
  targetType: reports.targetType,
  updatedAt: reports.updatedAt,
};

type ReportRow = Omit<ReportRecord, "targetType"> & {
  targetType: string;
};

const currentReportTargetTypeFilter = inArray(reports.targetType, ["SIGNAL", "USER"]);

function toCurrentReportTargetType(value: string): ReportRecord["targetType"] {
  if (value === "SIGNAL" || value === "USER") {
    return value;
  }

  throw new Error(`Unexpected current report target type: ${value}`);
}

function toReportRecord(row: ReportRow): ReportRecord {
  return {
    ...row,
    targetType: toCurrentReportTargetType(row.targetType),
  };
}

export async function createReportRecord(params: {
  body: CreateReportBody;
  reporterId: string;
}): Promise<ReportRecord> {
  const [report] = await db
    .insert(reports)
    .values({
      note: params.body.note,
      reason: params.body.reason,
      reporterId: params.reporterId,
      targetId: params.body.targetId,
      targetType: params.body.targetType,
    })
    .returning();

  if (report === undefined) {
    throw new Error("Report insert returned no row.");
  }

  const [row] = await db
    .select(reportSelection)
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.id, report.id))
    .limit(1);

  if (row === undefined) {
    throw new Error("Report insert lookup returned no row.");
  }

  return toReportRecord(row);
}

export async function listReportRecords(status?: ReportStatus): Promise<ReportRecord[]> {
  const filters =
    status === undefined
      ? currentReportTargetTypeFilter
      : and(currentReportTargetTypeFilter, eq(reports.status, status));

  const rows = await db
    .select(reportSelection)
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(filters)
    .orderBy(desc(reports.createdAt))
    .limit(50);

  return rows.map(toReportRecord);
}

export async function updateReportRecord(params: {
  id: string;
  resolution?: string;
  resolvedById: string;
  status: Exclude<ReportStatus, "PENDING">;
}): Promise<ReportRecord | undefined> {
  const [report] = await db
    .update(reports)
    .set({
      resolution: params.resolution,
      resolvedAt: new Date(),
      resolvedById: params.resolvedById,
      status: params.status,
      updatedAt: new Date(),
    })
    .where(and(eq(reports.id, params.id), currentReportTargetTypeFilter))
    .returning({
      id: reports.id,
    });

  if (report === undefined) {
    return undefined;
  }

  const [row] = await db
    .select(reportSelection)
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.id, params.id))
    .limit(1);

  return row === undefined ? undefined : toReportRecord(row);
}
