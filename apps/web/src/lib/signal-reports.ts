import { reportStatuses } from "@unfreq/contracts";
import type { CreateSignalReportRequest, ReportReceipt, ReportResponse, SignalReportResponse } from "@unfreq/contracts";
import { apiClient } from "./api-client";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const dateString = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function isReceipt(value: unknown, signalId: string): value is ReportReceipt {
  if (!isRecord(value)) return false;
  const keys = ["id", "targetId", "targetType", "status", "createdAt", "resolvedAt"];
  return Object.keys(value).every((key) => keys.includes(key)) &&
    ["id", "targetId", "targetType", "status", "createdAt"].every((key) => Object.hasOwn(value, key)) &&
    typeof value.id === "string" && value.id.length > 0 && value.targetId === signalId && value.targetType === "SIGNAL" &&
    reportStatuses.some((status) => value.status === status) && dateString(value.createdAt) &&
    (value.resolvedAt === undefined || dateString(value.resolvedAt));
}

export function isSignalReportResponse(value: unknown, signalId: string): value is SignalReportResponse {
  return isRecord(value) && Object.keys(value).every((key) => key === "report") &&
    (value.report === undefined || isReceipt(value.report, signalId));
}

export async function createSignalReport(signalId: string, reason: string, note: string, signal?: AbortSignal): Promise<ReportReceipt> {
  const result = await apiClient.post<ReportResponse, CreateSignalReportRequest>("/api/reports", {
    targetId: signalId, targetType: "SIGNAL", reason, ...(note.trim() === "" ? {} : { note: note.trim() }),
  }, { cache: "no-store", signal, validate: (value): value is ReportResponse =>
    isSignalReportResponse(value, signalId) && value.report !== undefined });
  return result.report;
}

export async function getOwnSignalReport(signalId: string, signal?: AbortSignal): Promise<ReportReceipt | undefined> {
  const result = await apiClient.get<SignalReportResponse>(`/api/reports/signal/${encodeURIComponent(signalId)}`, {
    cache: "no-store", signal, validate: (value): value is SignalReportResponse => isSignalReportResponse(value, signalId),
  });
  return result.report;
}
