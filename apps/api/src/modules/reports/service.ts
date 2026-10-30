import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { CreateReportBody, ReportStatus } from "./schemas.js";
import { createReportRecord, findOwnedReportRecord, listReportRecords, updateReportRecord } from "./repository.js";
import type { ReportReceipt } from "@unfreq/contracts";
import type { ReportDetail, ReportRecord } from "./types.js";

function toReportDetail(report: ReportRecord): ReportDetail {
  return {
    createdAt: report.createdAt.toISOString(),
    id: report.id,
    note: report.note ?? undefined,
    reason: report.reason,
    reporterFreqCode: report.reporterFreqCode,
    resolution: report.resolution ?? undefined,
    resolvedAt: report.resolvedAt?.toISOString(),
    status: report.status,
    targetId: report.targetId,
    targetType: report.targetType,
  };
}

export async function createReport(
  frequency: AuthenticatedFrequency,
  body: CreateReportBody,
): Promise<ReportReceipt> {
  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot send reports now.");
  }
  if (body.targetType !== "SIGNAL") {
    throw new AppError("VALIDATION_ERROR", "Only public signals can be reported here.");
  }

  const report = await createReportRecord({
    body,
    reporterId: frequency.id,
  });

  return toReportReceipt(report);
}

function toReportReceipt(report: ReportRecord): ReportReceipt {
  return { id: report.id, targetId: report.targetId, targetType: "SIGNAL", status: report.status,
    createdAt: report.createdAt.toISOString(),
    ...(report.resolvedAt === null ? {} : { resolvedAt: report.resolvedAt.toISOString() }) };
}

export async function getOwnSignalReport(frequency: AuthenticatedFrequency, signalId: string): Promise<ReportReceipt | undefined> {
  const report = await findOwnedReportRecord({ reporterId: frequency.id, signalId });
  return report === undefined ? undefined : toReportReceipt(report);
}

export async function listReports(status?: ReportStatus): Promise<ReportDetail[]> {
  const reportRows = await listReportRecords(status);

  return reportRows.map(toReportDetail);
}

export async function resolveReport(params: {
  adminId: string;
  id: string;
  resolution?: string;
  status: Exclude<ReportStatus, "PENDING">;
}): Promise<ReportDetail> {
  const report = await updateReportRecord({
    id: params.id,
    resolution: params.resolution,
    resolvedById: params.adminId,
    status: params.status,
  });

  if (report === undefined) {
    throw new AppError("NOT_FOUND", "Report not found.");
  }

  return toReportDetail(report);
}
