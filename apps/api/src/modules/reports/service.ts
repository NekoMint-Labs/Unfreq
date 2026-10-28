import { AppError } from "../../shared/errors.js";
import type { AuthenticatedFrequency } from "../auth/types.js";
import type { CreateReportBody, ReportStatus } from "./schemas.js";
import { createReportRecord, listReportRecords, updateReportRecord } from "./repository.js";
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
): Promise<ReportDetail> {
  if (frequency.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "This frequency cannot send reports now.");
  }

  const report = await createReportRecord({
    body,
    reporterId: frequency.id,
  });

  return toReportDetail(report);
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
