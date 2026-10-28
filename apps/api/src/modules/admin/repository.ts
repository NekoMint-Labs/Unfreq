import { and, count, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  adminActions,
  aiReviews,
  frequencies,
  reports,
  signals,
  users,
} from "../../db/schema.js";
import type {
  AdminAiReviewRecord,
  AdminFrequencyRecord,
  AdminOverview,
  AdminUserRecord,
} from "./types.js";
import type {
  AdminAiReviewStatus,
  AdminReportStatus,
  AdminSignalStatus,
  AdminUserStatus,
} from "./schemas.js";

async function countReportStatus(status: AdminReportStatus): Promise<number> {
  const [row] = await db.select({ value: count() }).from(reports).where(eq(reports.status, status));

  return row?.value ?? 0;
}

async function countUserStatus(status: AdminUserStatus): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.status, status));

  return row?.value ?? 0;
}

async function countFrequencyStatus(status: AdminUserStatus): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(frequencies)
    .where(eq(frequencies.status, status));

  return row?.value ?? 0;
}

async function countSignalStatus(status: AdminSignalStatus): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(signals)
    .where(eq(signals.status, status));

  return row?.value ?? 0;
}

async function countAiReviewFallback(reviewTypes: string[]): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(aiReviews)
    .where(
      and(
        eq(aiReviews.status, "FALLBACK"),
        reviewTypes.length === 1
          ? eq(aiReviews.reviewType, reviewTypes[0]!)
          : inArray(aiReviews.reviewType, reviewTypes),
      ),
    );

  return row?.value ?? 0;
}

function toCurrentTargetType(value: string | null): "SIGNAL" | "USER" | undefined {
  if (value === "SIGNAL" || value === "USER") {
    return value;
  }

  return undefined;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [reportsPending, reportsResolved, reportsRejected, usersActive, usersMuted, usersBanned, frequenciesActive, frequenciesMuted, frequenciesBanned, signalsPublished, signalsReviewing, signalsHidden, signalsDeleted, signalsDraft, aiReviewTotal, chatFallbacks, embeddingFailures, rerankerFailures, ttsFailures, galaxyMissingCoordinates] =
    await Promise.all([
      countReportStatus("PENDING"),
      countReportStatus("RESOLVED"),
      countReportStatus("REJECTED"),
      countUserStatus("ACTIVE"),
      countUserStatus("MUTED"),
      countUserStatus("BANNED"),
      countFrequencyStatus("ACTIVE"),
      countFrequencyStatus("MUTED"),
      countFrequencyStatus("BANNED"),
      countSignalStatus("PUBLISHED"),
      countSignalStatus("REVIEWING"),
      countSignalStatus("HIDDEN"),
      countSignalStatus("DELETED"),
      countSignalStatus("DRAFT"),
      db.select({ value: count() }).from(aiReviews).then((rows) => rows[0]?.value ?? 0),
      countAiReviewFallback([
        "signal-expansion",
        "signal-fingerprint",
        "signal-intent-analysis",
        "signal-program",
      ]),
      db
        .select({ value: count() })
        .from(signals)
        .where(isNull(signals.embedding))
        .then((rows) => rows[0]?.value ?? 0),
      countAiReviewFallback(["signal-rerank"]),
      db
        .select({ value: count() })
        .from(signals)
        .where(eq(signals.audioStatus, "FAILED"))
        .then((rows) => rows[0]?.value ?? 0),
      db
        .select({ value: count() })
        .from(signals)
        .where(isNull(signals.galaxyPosition))
        .then((rows) => rows[0]?.value ?? 0),
    ]);

  return {
    aiReviews: {
      total: aiReviewTotal,
    },
    aiOperations: {
      chatFallbacks,
      embeddingFailures,
      rerankerFailures,
      ttsFailures,
    },
    frequencies: {
      active: frequenciesActive,
      banned: frequenciesBanned,
      muted: frequenciesMuted,
    },
    galaxy: {
      missingCoordinates: galaxyMissingCoordinates,
    },
    reports: {
      pending: reportsPending,
      rejected: reportsRejected,
      resolved: reportsResolved,
    },
    signals: {
      deleted: signalsDeleted,
      draft: signalsDraft,
      hidden: signalsHidden,
      published: signalsPublished,
      reviewing: signalsReviewing,
      total: signalsPublished + signalsReviewing + signalsHidden + signalsDeleted + signalsDraft,
    },
    users: {
      active: usersActive,
      banned: usersBanned,
      muted: usersMuted,
    },
  };
}

export async function listAdminUserRecords(status?: AdminUserStatus): Promise<AdminUserRecord[]> {
  const rows = await db
    .select({
      createdAt: users.createdAt,
      email: users.email,
      frequencyName: users.frequencyName,
      freqCode: users.freqCode,
      id: users.id,
      isGuest: users.isGuest,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(status === undefined ? undefined : eq(users.status, status))
    .orderBy(desc(users.createdAt))
    .limit(50);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listAdminAiReviewRecords(params: {
  reviewType?: string;
  status?: AdminAiReviewStatus;
}): Promise<AdminAiReviewRecord[]> {
  let filters: SQL | undefined;
  const targetTypeFilter = inArray(aiReviews.targetType, ["SIGNAL", "USER"]);

  if (params.reviewType !== undefined && params.status !== undefined) {
    filters = and(
      targetTypeFilter,
      eq(aiReviews.reviewType, params.reviewType),
      eq(aiReviews.status, params.status),
    );
  } else if (params.reviewType !== undefined) {
    filters = and(targetTypeFilter, eq(aiReviews.reviewType, params.reviewType));
  } else if (params.status !== undefined) {
    filters = and(targetTypeFilter, eq(aiReviews.status, params.status));
  } else {
    filters = targetTypeFilter;
  }

  const rows = await db
    .select({
      createdAt: aiReviews.createdAt,
      id: aiReviews.id,
      inputText: aiReviews.inputText,
      model: aiReviews.model,
      outputJson: aiReviews.outputJson,
      provider: aiReviews.provider,
      reviewType: aiReviews.reviewType,
      status: aiReviews.status,
      targetId: aiReviews.targetId,
      targetType: aiReviews.targetType,
    })
    .from(aiReviews)
    .where(filters)
    .orderBy(desc(aiReviews.createdAt))
    .limit(50);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    outputJson: row.outputJson as Record<string, unknown>,
    status: row.status as AdminAiReviewStatus,
    targetId: row.targetId ?? undefined,
    targetType: toCurrentTargetType(row.targetType),
  }));
}

export async function updateAdminUserStatus(params: {
  id: string;
  status: AdminUserStatus;
}): Promise<AdminUserRecord | undefined> {
  const [updatedRow] = await db.transaction(async (tx) => {
    const updatedUsers = await tx
      .update(users)
      .set({
        status: params.status,
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.id))
      .returning({
        id: users.id,
      });

    await tx
      .update(frequencies)
      .set({
        status: params.status,
        updatedAt: new Date(),
      })
      .where(eq(frequencies.id, params.id));

    return updatedUsers;
  });

  if (updatedRow === undefined) {
    return undefined;
  }

  const [row] = await db
    .select({
      createdAt: users.createdAt,
      email: users.email,
      frequencyName: users.frequencyName,
      freqCode: users.freqCode,
      id: users.id,
      isGuest: users.isGuest,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, params.id))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAdminFrequencyRecords(
  status?: AdminUserStatus,
): Promise<AdminFrequencyRecord[]> {
  const rows = await db
    .select({
      code: frequencies.code,
      createdAt: frequencies.createdAt,
      frequencyName: frequencies.frequencyName,
      id: frequencies.id,
      isGuest: frequencies.isGuest,
      lastSeenAt: frequencies.lastSeenAt,
      role: frequencies.role,
      status: frequencies.status,
    })
    .from(frequencies)
    .where(status === undefined ? undefined : eq(frequencies.status, status))
    .orderBy(desc(frequencies.createdAt))
    .limit(50);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    frequencyName: row.frequencyName ?? undefined,
    lastSeenAt: row.lastSeenAt?.toISOString(),
  }));
}

export async function updateAdminFrequencyStatus(params: {
  id: string;
  status: AdminUserStatus;
}): Promise<AdminFrequencyRecord | undefined> {
  const now = new Date();
  const [updatedRow] = await db.transaction(async (tx) => {
    const updatedFrequencies = await tx
      .update(frequencies)
      .set({
        status: params.status,
        updatedAt: now,
      })
      .where(eq(frequencies.id, params.id))
      .returning({
        id: frequencies.id,
      });

    await tx
      .update(users)
      .set({
        status: params.status,
        updatedAt: now,
      })
      .where(eq(users.id, params.id));

    return updatedFrequencies;
  });

  if (updatedRow === undefined) {
    return undefined;
  }

  const [row] = await db
    .select({
      code: frequencies.code,
      createdAt: frequencies.createdAt,
      frequencyName: frequencies.frequencyName,
      id: frequencies.id,
      isGuest: frequencies.isGuest,
      lastSeenAt: frequencies.lastSeenAt,
      role: frequencies.role,
      status: frequencies.status,
    })
    .from(frequencies)
    .where(eq(frequencies.id, params.id))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    frequencyName: row.frequencyName ?? undefined,
    lastSeenAt: row.lastSeenAt?.toISOString(),
  };
}

export async function recordAdminAction(params: {
  action: string;
  adminId: string;
  details?: Record<string, unknown>;
  targetId: string;
  targetType: "SIGNAL" | "USER";
}) {
  await db.insert(adminActions).values({
    action: params.action,
    adminId: params.adminId,
    details: params.details ?? null,
    targetId: params.targetId,
    targetType: params.targetType,
  });
}
