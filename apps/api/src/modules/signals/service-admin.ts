import { AppError } from "../../shared/errors.js";
import {
  deleteSignalByAdmin,
  listAdminSignals,
  markSignalKeptByAdmin,
  updateSignalStatusByAdmin,
} from "./repository.js";
import { adminSignalDefaultLimit, adminSignalMaxLimit } from "./service-constants.js";
import { isFiniteGalaxyPosition, toSignalDetail } from "./service-mappers.js";
import type {
  AdminSignalListQuery,
  AdminSignalSummary,
  SignalDetail,
  SignalRecord,
  SignalStatus,
} from "./types.js";
import type { AdminSignalPage } from "@unfreq/contracts/admin";

type AdminSignalCursor = {
  createdAt: Date;
  id: string;
};

function normalizeAdminSignalLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? adminSignalDefaultLimit, 1), adminSignalMaxLimit);
}

function parseAdminSignalCursor(cursor?: string): AdminSignalCursor | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };

    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      return undefined;
    }

    const createdAt = new Date(parsed.createdAt);

    if (Number.isNaN(createdAt.getTime()) || parsed.id.length === 0) {
      return undefined;
    }

    return {
      createdAt,
      id: parsed.id,
    };
  } catch {
    return undefined;
  }
}

export async function getAdminSignals(query: AdminSignalListQuery): Promise<{
  hasNextPage: boolean;
  items: SignalDetail[];
  limit: number;
  nextCursor?: string;
  total: number;
}> {
  const limit = normalizeAdminSignalLimit(query.limit);
  const signals = await listAdminSignals({
    cursor: parseAdminSignalCursor(query.cursor),
    limit,
    q: query.q,
    source: query.source,
    status: query.status,
  });

  return {
    hasNextPage: signals.hasNextPage,
    items: signals.items.map(toSignalDetail),
    limit,
    nextCursor: signals.nextCursor,
    total: signals.total,
  };
}

function toAdminSignalSummary(signal: SignalRecord): AdminSignalSummary {
  return {
    audioStatus: signal.audioStatus,
    createdAt: signal.createdAt.toISOString(),
    embedding: {
      dimensions: signal.embeddingDimensions ?? undefined,
      model: signal.embeddingModel ?? undefined,
      provider: signal.embeddingProvider ?? undefined,
      status: signal.embedding === null ? "missing" : "ready",
      version: signal.embeddingVersion ?? undefined,
    },
    expandedText: signal.expandedText,
    frequencyCode: signal.authorFreqCode ?? signal.fingerprintJson.frequency,
    galaxyPositionStatus: isFiniteGalaxyPosition(signal.galaxyPosition) ? "ready" : "missing",
    id: signal.id,
    parentSignalId: signal.parentSignalId ?? undefined,
    qualityReason: signal.qualityReason ?? undefined,
    qualityScore: signal.qualityScore ?? undefined,
    resonanceCount: signal.resonanceCount,
    seedText: signal.seedText,
    source: signal.source,
    status: signal.status,
    updatedAt: signal.updatedAt.toISOString(),
  };
}

export async function getAdminSignalSummaries(
  query: AdminSignalListQuery = {},
): Promise<AdminSignalPage> {
  const limit = normalizeAdminSignalLimit(query.limit);
  const signals = await listAdminSignals({
    cursor: parseAdminSignalCursor(query.cursor),
    limit,
    q: query.q,
    source: query.source,
    status: query.status,
  });

  return {
    hasNextPage: signals.hasNextPage,
    items: signals.items.map(toAdminSignalSummary),
    limit,
    nextCursor: signals.nextCursor,
    total: signals.total,
  };
}

export async function updateAdminSignalStatus(params: {
  id: string;
  status: SignalStatus;
}): Promise<AdminSignalSummary> {
  const signal = await updateSignalStatusByAdmin(params);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  return toAdminSignalSummary(signal);
}

export async function deleteAdminSignal(id: string): Promise<SignalDetail> {
  const signal = await deleteSignalByAdmin(id);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  return toSignalDetail(signal);
}

export async function keepAdminSignal(params: {
  id: string;
  isKept: boolean;
}): Promise<SignalDetail> {
  const signal = await markSignalKeptByAdmin(params);

  if (signal === undefined) {
    throw new AppError("NOT_FOUND", "Signal not found.");
  }

  return toSignalDetail(signal);
}
