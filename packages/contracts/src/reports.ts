export const reportStatuses = ["PENDING", "RESOLVED", "REJECTED"] as const;
export type ReportStatus = typeof reportStatuses[number];

export type CreateSignalReportRequest = {
  targetType: "SIGNAL";
  targetId: string;
  reason: string;
  note?: string;
};

// Review text, reporter identity and internal moderation notes are admin-only.
export type ReportReceipt = {
  id: string;
  targetType: "SIGNAL";
  targetId: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt?: string;
};
export type ReportResponse = { report: ReportReceipt };
export type SignalReportResponse = { report?: ReportReceipt };
