import type { ReportStatus, ReportTargetType } from "./schemas.js";

export type ReportRecord = {
  createdAt: Date;
  id: string;
  note: string | null;
  reason: string;
  reporterFreqCode: string;
  reporterId: string;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolution: string | null;
  status: ReportStatus;
  targetId: string;
  targetType: ReportTargetType;
  updatedAt: Date;
};

export type ReportDetail = {
  createdAt: string;
  id: string;
  note?: string;
  reason: string;
  reporterFreqCode: string;
  resolution?: string;
  resolvedAt?: string;
  status: ReportStatus;
  targetId: string;
  targetType: ReportTargetType;
};
