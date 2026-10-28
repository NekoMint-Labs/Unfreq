import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  frequencies,
  signalEchoes,
  signalResonances,
  signalSaves,
  signals,
  users,
} from "../../db/schema.js";
import { serializePgVector } from "../../db/vector.js";
import type {
  CreateSignalInput,
  SignalAudioStatus,
  SignalEchoRecord,
  SignalFingerprint,
  SignalPrimaryBand,
  SignalGalaxyPosition,
  SignalGenerationStatus,
  SignalProgram,
  SignalRecord,
  AdminSignalListPage,
  SignalResonanceResult,
  SavedSignalRecord,
  SignalSemanticMatchRecord,
  SignalSource,
  SignalStatus,
  SignalSubFeeling,
  WriteSignalEmbeddingInput,
} from "./types.js";

export class SignalNotFoundForInteraction extends Error {
  constructor() {
    super("Signal not found for interaction.");
    this.name = "SignalNotFoundForInteraction";
  }
}

const signalSelection = {
  authorFreqCode: users.freqCode,
  authorId: signals.authorId,
  audioError: signals.audioError,
  audioStatus: signals.audioStatus,
  audioStorageKey: signals.audioStorageKey,
  audioStorageKeyLeft: signals.audioStorageKeyLeft,
  audioStorageKeyRight: signals.audioStorageKeyRight,
  audioUrl: signals.audioUrl,
  audioUrlLeft: signals.audioUrlLeft,
  audioUrlRight: signals.audioUrlRight,
  createdAt: signals.createdAt,
  echoCount: signals.echoCount,
  embedding: signals.embedding,
  embeddingDimensions: signals.embeddingDimensions,
  embeddingModel: signals.embeddingModel,
  embeddingProvider: signals.embeddingProvider,
  embeddingVersion: signals.embeddingVersion,
  expandedText: signals.expandedText,
  fingerprintJson: signals.fingerprintJson,
  followUpQuestion: signals.followUpQuestion,
  frequencyId: signals.frequencyId,
  galaxyPosition: signals.galaxyPosition,
  generationError: signals.generationError,
  generationStatus: signals.generationStatus,
  guestKey: signals.guestKey,
  id: signals.id,
  coreNeed: signals.coreNeed,
  emotionTone: signals.emotionTone,
  innerConflict: signals.innerConflict,
  matchSignalId: signals.matchSignalId,
  parentSignalId: signals.parentSignalId,
  primaryBand: signals.primaryBand,
  programJson: signals.programJson,
  qualityReason: signals.qualityReason,
  qualityScore: signals.qualityScore,
  rawInput: signals.rawInput,
  resonanceCount: signals.resonanceCount,
  resonanceKeywords: signals.resonanceKeywords,
  seedText: signals.seedText,
  source: signals.source,
  status: signals.status,
  subFeeling: signals.subFeeling,
  isKept: signals.isKept,
  updatedAt: signals.updatedAt,
};

type SignalSelectionRow = {
  authorFreqCode: string | null;
  authorId: string | null;
  audioError: string | null;
  audioStatus: SignalAudioStatus;
  audioStorageKey: string | null;
  audioStorageKeyLeft: string | null;
  audioStorageKeyRight: string | null;
  audioUrl: string | null;
  audioUrlLeft: string | null;
  audioUrlRight: string | null;
  createdAt: Date;
  echoCount: number;
  embedding: number[] | null;
  embeddingDimensions: number | null;
  embeddingModel: string | null;
  embeddingProvider: string | null;
  embeddingVersion: string | null;
  expandedText: string;
  fingerprintJson: Record<string, unknown>;
  followUpQuestion: string | null;
  frequencyId: string | null;
  galaxyPosition: { x: number; y: number; z: number } | null;
  generationError: string | null;
  generationStatus: SignalGenerationStatus;
  guestKey: string | null;
  id: string;
  coreNeed: string | null;
  emotionTone: string | null;
  innerConflict: string | null;
  matchSignalId: string | null;
  parentSignalId: string | null;
  primaryBand: SignalPrimaryBand | null;
  programJson: Record<string, unknown>;
  qualityReason: string | null;
  qualityScore: number | null;
  rawInput: string;
  resonanceCount: number;
  resonanceKeywords: string[] | null;
  seedText: string;
  source: SignalSource;
  status: SignalStatus;
  subFeeling: SignalSubFeeling | null;
  isKept: boolean;
  updatedAt: Date;
};

function toSignalRecord(row: SignalSelectionRow): SignalRecord {
  return {
    ...row,
    fingerprintJson: row.fingerprintJson as SignalFingerprint,
    programJson: row.programJson as SignalProgram,
  };
}

function toSemanticSignalRecord(
  row: SignalSelectionRow & { semanticDistance: number | string },
): SignalSemanticMatchRecord {
  return {
    ...toSignalRecord(row),
    distance: Number(row.semanticDistance),
  };
}

function getPublicCompletedSignalFilters() {
  return [
    eq(signals.status, "PUBLISHED"),
    eq(signals.generationStatus, "COMPLETED"),
  ];
}

async function findSignalById(id: string): Promise<SignalRecord | undefined> {
  const [row] = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(eq(signals.id, id))
    .limit(1);

  return row === undefined ? undefined : toSignalRecord(row);
}

export async function findSignalResultById(id: string): Promise<SignalRecord | undefined> {
  const signal = await findSignalById(id);

  return signal?.status === "DELETED" ? undefined : signal;
}

export async function createSignalDraft(input: CreateSignalInput): Promise<SignalRecord> {
  const [signal] = await db
    .insert(signals)
    .values({
      authorId: input.authorId,
      expandedText: input.expandedText ?? input.rawInput,
      fingerprintJson: input.fingerprint,
      followUpQuestion: input.followUpQuestion ?? null,
      frequencyId: input.frequencyId,
      galaxyPosition: input.galaxyPosition,
      generationError: input.generationError ?? null,
      generationStatus: input.generationStatus ?? "COMPLETED",
      guestKey: input.guestKey,
      coreNeed: input.frequencyProfile?.coreNeed,
      emotionTone: input.frequencyProfile?.emotionTone,
      innerConflict: input.frequencyProfile?.innerConflict,
      matchSignalId: input.matchSignalId,
      parentSignalId: input.parentSignalId,
      primaryBand: input.frequencyProfile?.primaryBand,
      programJson: input.program,
      qualityReason: input.qualityReason,
      qualityScore: input.qualityScore,
      rawInput: input.rawInput,
      seedText: input.seedText ?? input.rawInput,
      resonanceKeywords: input.frequencyProfile?.resonanceKeywords,
      source: input.source ?? "human",
      status: input.status ?? "DRAFT",
      subFeeling: input.frequencyProfile?.subFeeling,
    })
    .returning({
      id: signals.id,
    });

  if (signal === undefined) {
    throw new Error("Signal insert returned no row.");
  }

  const createdSignal = await findSignalById(signal.id);

  if (createdSignal === undefined) {
    throw new Error("Signal insert could not be read back.");
  }

  return createdSignal;
}

export async function updateSignalGenerationStatus(params: {
  error?: string | null;
  id: string;
  status: SignalGenerationStatus;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      generationError: params.error === undefined ? null : params.error?.slice(0, 240) ?? null,
      generationStatus: params.status,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, params.id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function completeSignalGeneration(params: {
  id: string;
  input: CreateSignalInput;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      authorId: params.input.authorId,
      expandedText: params.input.expandedText ?? params.input.rawInput,
      fingerprintJson: params.input.fingerprint,
      followUpQuestion: params.input.followUpQuestion ?? null,
      frequencyId: params.input.frequencyId,
      galaxyPosition: params.input.galaxyPosition ?? null,
      generationError: null,
      generationStatus: "COMPLETED",
      guestKey: params.input.guestKey ?? null,
      coreNeed: params.input.frequencyProfile?.coreNeed ?? null,
      emotionTone: params.input.frequencyProfile?.emotionTone ?? null,
      innerConflict: params.input.frequencyProfile?.innerConflict ?? null,
      matchSignalId: params.input.matchSignalId ?? null,
      parentSignalId: params.input.parentSignalId ?? null,
      primaryBand: params.input.frequencyProfile?.primaryBand ?? null,
      programJson: params.input.program,
      qualityReason: params.input.qualityReason ?? null,
      qualityScore: params.input.qualityScore ?? null,
      rawInput: params.input.rawInput,
      seedText: params.input.seedText ?? params.input.rawInput,
      resonanceKeywords: params.input.frequencyProfile?.resonanceKeywords ?? null,
      source: params.input.source ?? "human",
      status: params.input.status ?? "DRAFT",
      subFeeling: params.input.frequencyProfile?.subFeeling ?? null,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, params.id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function listPublishedSignals(limit: number): Promise<SignalRecord[]> {
  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(...getPublicCompletedSignalFilters()))
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return rows.map(toSignalRecord);
}

export async function listPublishedGalaxySignals(params: {
  band?: SignalPrimaryBand;
  limit: number;
  theme?: string;
}): Promise<SignalRecord[]> {
  const filters = getPublicCompletedSignalFilters();

  if (params.band !== undefined) {
    filters.push(eq(signals.primaryBand, params.band));
  } else if (params.theme !== undefined) {
    const legacyBandByTheme: Record<string, SignalPrimaryBand> = {
      情绪暗流: "emotional_undercurrent",
      时代星群: "era_cluster",
      意义深空: "meaning_deep_space",
      关系星云: "relationship_nebula",
      自我镜像: "self_mirror",
      停滞轨道: "stagnant_orbit",
      时间星环: "time_ring",
    };
    const legacyBand = legacyBandByTheme[params.theme];

    if (legacyBand !== undefined) {
      filters.push(eq(signals.primaryBand, legacyBand));
    } else {
      filters.push(sql<boolean>`${signals.fingerprintJson}->>'theme' = ${params.theme}`);
    }
  }

  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(...filters))
    .orderBy(asc(signals.createdAt))
    .limit(params.limit);

  return rows.map(toSignalRecord);
}

export async function listPublishedGalaxyThemes(limit: number): Promise<string[]> {
  const rows = await db
    .select({
      theme: sql<string>`coalesce(${signals.primaryBand}::text, ${signals.fingerprintJson}->>'theme')`,
    })
    .from(signals)
    .where(and(
      ...getPublicCompletedSignalFilters(),
      sql<boolean>`coalesce(${signals.primaryBand}::text, ${signals.fingerprintJson}->>'theme', '') <> ''`,
    ))
    .groupBy(sql`coalesce(${signals.primaryBand}::text, ${signals.fingerprintJson}->>'theme')`)
    .orderBy(sql`coalesce(${signals.primaryBand}::text, ${signals.fingerprintJson}->>'theme')`)
    .limit(limit);

  return rows
    .map((row) => row.theme.trim())
    .filter((theme) => theme.length > 0);
}

export async function findSignalSave(params: {
  frequencyId: string;
  signalId: string;
}): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({
      id: signalSaves.id,
    })
    .from(signalSaves)
    .where(
      and(
        eq(signalSaves.frequencyId, params.frequencyId),
        eq(signalSaves.signalId, params.signalId),
      ),
    )
    .limit(1);

  return row;
}

export async function findRandomPublishedSignal(params: {
  excludeFrequencyId?: string;
} = {}): Promise<SignalRecord | undefined> {
  const filters = getPublicCompletedSignalFilters();

  if (params.excludeFrequencyId !== undefined) {
    filters.push(
      sql<boolean>`coalesce(${signals.frequencyId}, ${signals.authorId}) is distinct from ${params.excludeFrequencyId}`,
    );
  }

  const [row] = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(...filters))
    .orderBy(sql`random()`)
    .limit(1);

  return row === undefined ? undefined : toSignalRecord(row);
}

export async function listPublishedSignalMatchCandidates(
  limit: number,
  excludeSignalId?: string,
): Promise<SignalRecord[]> {
  const filters = getPublicCompletedSignalFilters();

  if (excludeSignalId !== undefined) {
    filters.push(ne(signals.id, excludeSignalId));
  }

  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(...filters))
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return rows.map(toSignalRecord);
}

export async function listPublishedSemanticSignalMatchCandidates(
  embedding: number[],
  limit: number,
  excludeSignalId?: string,
  embeddingVersion?: string,
): Promise<SignalSemanticMatchRecord[]> {
  const queryVector = serializePgVector(embedding);
  const distance = sql<number>`${signals.embedding} <=> ${queryVector}::vector`.mapWith(Number);
  const filters = [...getPublicCompletedSignalFilters(), isNotNull(signals.embedding)];

  if (embeddingVersion !== undefined) {
    filters.push(eq(signals.embeddingVersion, embeddingVersion));
  }

  if (excludeSignalId !== undefined) {
    filters.push(ne(signals.id, excludeSignalId));
  }

  const rows = await db
    .select({
      ...signalSelection,
      semanticDistance: distance,
    })
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(...filters))
    .orderBy(distance)
    .limit(limit);

  return rows
    .map(toSemanticSignalRecord)
    .filter((row) => Number.isFinite(row.distance));
}

export async function listSignalsMissingEmbedding(limit: number): Promise<SignalRecord[]> {
  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(eq(signals.generationStatus, "COMPLETED"), isNull(signals.embedding)))
    .orderBy(asc(signals.createdAt))
    .limit(limit);

  return rows.map(toSignalRecord);
}

export async function listSignalsMissingGalaxyPosition(limit: number): Promise<SignalRecord[]> {
  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(eq(signals.generationStatus, "COMPLETED"), isNull(signals.galaxyPosition)))
    .orderBy(asc(signals.createdAt))
    .limit(limit);

  return rows.map(toSignalRecord);
}

export async function listSignalsByRawInput(rawInputs: string[]): Promise<SignalRecord[]> {
  if (rawInputs.length === 0) {
    return [];
  }

  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(inArray(signals.rawInput, rawInputs));

  return rows.map(toSignalRecord);
}

export async function writeSignalEmbeddingIfMissing(
  params: WriteSignalEmbeddingInput,
): Promise<boolean> {
  const [updated] = await db
    .update(signals)
    .set({
      embedding: params.embedding,
      embeddingDimensions: params.dimensions,
      embeddingModel: params.model,
      embeddingProvider: params.provider,
      embeddingVersion: params.version,
      updatedAt: new Date(),
    })
    .where(and(eq(signals.id, params.id), isNull(signals.embedding)))
    .returning({
      id: signals.id,
    });

  return updated !== undefined;
}

export async function writeSignalGalaxyPositionIfMissing(params: {
  id: string;
  position: SignalGalaxyPosition;
}): Promise<boolean> {
  const [updated] = await db
    .update(signals)
    .set({
      galaxyPosition: params.position,
      updatedAt: new Date(),
    })
    .where(and(eq(signals.id, params.id), isNull(signals.galaxyPosition)))
    .returning({
      id: signals.id,
    });

  return updated !== undefined;
}

export async function markSignalAudioPending(id: string): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      audioError: null,
      audioStatus: "PENDING",
      updatedAt: new Date(),
    })
    .where(eq(signals.id, id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function markSignalAudioReady(params: {
  id: string;
  storageKey?: string;
  storageKeyLeft: string;
  storageKeyRight: string;
  url?: string;
  urlLeft: string;
  urlRight: string;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      audioError: null,
      audioStatus: "READY",
      audioStorageKey: params.storageKey,
      audioStorageKeyLeft: params.storageKeyLeft,
      audioStorageKeyRight: params.storageKeyRight,
      audioUrl: params.url,
      audioUrlLeft: params.urlLeft,
      audioUrlRight: params.urlRight,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, params.id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function markSignalAudioFailed(params: {
  error: string;
  id: string;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      audioError: params.error.slice(0, 240),
      audioStatus: "FAILED",
      updatedAt: new Date(),
    })
    .where(eq(signals.id, params.id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function findPublishedSignalById(id: string): Promise<SignalRecord | undefined> {
  const [row] = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(eq(signals.id, id), ...getPublicCompletedSignalFilters()))
    .limit(1);

  return row === undefined ? undefined : toSignalRecord(row);
}

export async function createSignalEcho(params: {
  authorId?: string;
  content: string;
  guestKey?: string;
  signalId: string;
}): Promise<SignalEchoRecord> {
  return db.transaction(async (tx) => {
    const [signal] = await tx
      .select({
        id: signals.id,
      })
      .from(signals)
      .where(and(eq(signals.id, params.signalId), ...getPublicCompletedSignalFilters()))
      .limit(1);

    if (signal === undefined) {
      throw new SignalNotFoundForInteraction();
    }

    const [echo] = await tx
      .insert(signalEchoes)
      .values({
        authorId: params.authorId,
        content: params.content,
        guestKey: params.guestKey,
        signalId: params.signalId,
      })
      .returning({
        authorId: signalEchoes.authorId,
        content: signalEchoes.content,
        createdAt: signalEchoes.createdAt,
        guestKey: signalEchoes.guestKey,
        id: signalEchoes.id,
        signalId: signalEchoes.signalId,
        status: signalEchoes.status,
        updatedAt: signalEchoes.updatedAt,
      });

    if (echo === undefined) {
      throw new Error("Signal echo insert returned no row.");
    }

    await tx
      .update(signals)
      .set({
        echoCount: sql`${signals.echoCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(signals.id, params.signalId));

    if (params.authorId === undefined) {
      return {
        ...echo,
        authorFreqCode: null,
      };
    }

    const [author] = await tx
      .select({
        freqCode: users.freqCode,
      })
      .from(users)
      .where(eq(users.id, params.authorId))
      .limit(1);

    return {
      ...echo,
      authorFreqCode: author?.freqCode ?? null,
    };
  });
}

export async function createSignalEchoForPersona(params: {
  content: string;
  guestKey: string;
  signalId: string;
}): Promise<SignalEchoRecord> {
  return createSignalEcho({
    content: params.content,
    guestKey: params.guestKey,
    signalId: params.signalId,
  });
}

export async function createSignalResonance(params: {
  actorKey: string;
  authorId?: string;
  frequencyId?: string;
  guestKey?: string;
  signalId: string;
}): Promise<SignalResonanceResult> {
  return db.transaction(async (tx) => {
    const [signal] = await tx
      .select({
        resonanceCount: signals.resonanceCount,
      })
      .from(signals)
      .where(and(eq(signals.id, params.signalId), ...getPublicCompletedSignalFilters()))
      .limit(1);

    if (signal === undefined) {
      throw new SignalNotFoundForInteraction();
    }

    const [inserted] = await tx
      .insert(signalResonances)
      .values({
        actorKey: params.actorKey,
        authorId: params.authorId,
        frequencyId: params.frequencyId,
        guestKey: params.guestKey,
        signalId: params.signalId,
      })
      .onConflictDoNothing({
        target: [signalResonances.signalId, signalResonances.actorKey],
      })
      .returning({
        id: signalResonances.id,
      });

    if (inserted === undefined) {
      return {
        hasResonated: true,
        resonanceCount: signal.resonanceCount,
      };
    }

    const [updatedSignal] = await tx
      .update(signals)
      .set({
        resonanceCount: sql`${signals.resonanceCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(signals.id, params.signalId))
      .returning({
        resonanceCount: signals.resonanceCount,
      });

    return {
      hasResonated: true,
      resonanceCount: updatedSignal?.resonanceCount ?? signal.resonanceCount + 1,
    };
  });
}

export async function createSignalResonanceForPersona(params: {
  actorKey: string;
  guestKey: string;
  signalId: string;
}): Promise<SignalResonanceResult> {
  return createSignalResonance({
    actorKey: params.actorKey,
    guestKey: params.guestKey,
    signalId: params.signalId,
  });
}

export async function deleteSignalByAdmin(id: string): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      status: "DELETED",
      updatedAt: new Date(),
    })
    .where(eq(signals.id, id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function updateSignalStatusByAdmin(params: {
  id: string;
  status: SignalStatus;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      status: params.status,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, params.id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function publishSignalForFrequency(params: {
  frequencyId: string;
  id: string;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      status: "PUBLISHED",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(signals.id, params.id),
        eq(signals.status, "DRAFT"),
        eq(signals.generationStatus, "COMPLETED"),
        or(
          eq(signals.frequencyId, params.frequencyId),
          eq(signals.authorId, params.frequencyId),
        ),
      ),
    )
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function markSignalKeptByAdmin(params: {
  id: string;
  isKept: boolean;
}): Promise<SignalRecord | undefined> {
  const [updated] = await db
    .update(signals)
    .set({
      isKept: params.isKept,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, params.id))
    .returning({
      id: signals.id,
    });

  return updated === undefined ? undefined : findSignalById(updated.id);
}

export async function listAdminSignals(params: {
  cursor?: {
    createdAt: Date;
    id: string;
  };
  limit: number;
  q?: string;
  source?: SignalSource;
  status?: SignalStatus;
}): Promise<AdminSignalListPage> {
  const normalizedQuery = params.q?.trim();
  const filters = [
    params.source === undefined ? undefined : eq(signals.source, params.source),
    params.status === undefined ? undefined : eq(signals.status, params.status),
    normalizedQuery === undefined || normalizedQuery.length === 0
      ? undefined
      : or(
          sql`${signals.seedText} ILIKE ${`%${normalizedQuery}%`}`,
          sql`${signals.expandedText} ILIKE ${`%${normalizedQuery}%`}`,
          sql`${signals.status}::text ILIKE ${`%${normalizedQuery}%`}`,
          sql`${signals.source}::text ILIKE ${`%${normalizedQuery}%`}`,
          sql`${users.freqCode} ILIKE ${`%${normalizedQuery}%`}`,
        ),
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
  const baseFilter = filters.length === 0 ? undefined : and(...filters);
  const cursorFilter =
    params.cursor === undefined
      ? undefined
      : or(
          lt(signals.createdAt, params.cursor.createdAt),
          and(eq(signals.createdAt, params.cursor.createdAt), lt(signals.id, params.cursor.id)),
        );
  const pageFilter =
    baseFilter === undefined
      ? cursorFilter
      : cursorFilter === undefined
        ? baseFilter
        : and(baseFilter, cursorFilter);

  const [countRow, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(signals)
      .leftJoin(users, eq(signals.authorId, users.id))
      .where(baseFilter),
    db
      .select(signalSelection)
      .from(signals)
      .leftJoin(users, eq(signals.authorId, users.id))
      .where(pageFilter)
      .orderBy(desc(signals.createdAt), desc(signals.id))
      .limit(params.limit + 1),
  ]);
  const items = rows.slice(0, params.limit).map(toSignalRecord);
  const lastItem = items.at(-1);

  return {
    hasNextPage: rows.length > params.limit,
    items,
    nextCursor:
      rows.length > params.limit && lastItem !== undefined
        ? Buffer.from(
            JSON.stringify({
              createdAt: lastItem.createdAt.toISOString(),
              id: lastItem.id,
            }),
            "utf8",
          ).toString("base64url")
        : undefined,
    total: countRow[0]?.value ?? 0,
  };
}

export async function findVisibleSignalForFrequency(params: {
  frequencyId: string;
  id: string;
}): Promise<SignalRecord | undefined> {
  const [row] = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(
      and(
        eq(signals.id, params.id),
        eq(signals.generationStatus, "COMPLETED"),
        ne(signals.status, "DELETED"),
        sql<boolean>`coalesce(${signals.frequencyId}, ${signals.authorId}) = ${params.frequencyId}`,
      ),
    )
    .limit(1);

  return row === undefined ? undefined : toSignalRecord(row);
}

export async function listSignalsForAuthor(params: {
  authorId: string;
  limit: number;
}): Promise<SignalRecord[]> {
  const rows = await db
    .select(signalSelection)
    .from(signals)
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(
      eq(signals.authorId, params.authorId),
      eq(signals.generationStatus, "COMPLETED"),
      ne(signals.status, "DELETED"),
    ))
    .orderBy(desc(signals.createdAt))
    .limit(params.limit);

  return rows.map(toSignalRecord);
}

export async function getFrequencyLastSeenAt(frequencyId: string): Promise<Date | null> {
  const [frequency] = await db
    .select({
      lastSeenAt: frequencies.lastSeenAt,
    })
    .from(frequencies)
    .where(eq(frequencies.id, frequencyId))
    .limit(1);

  return frequency?.lastSeenAt ?? null;
}

export async function touchFrequencyLastSeenAt(params: {
  frequencyId: string;
  seenAt: Date;
}): Promise<void> {
  await db
    .update(frequencies)
    .set({
      lastSeenAt: params.seenAt,
      updatedAt: params.seenAt,
    })
    .where(eq(frequencies.id, params.frequencyId));
}

export async function summarizeSignalResonancesSince(params: {
  authorId: string;
  since: Date;
}): Promise<{
  newResonanceCount: number;
  topSignal?: SignalRecord;
}> {
  const rows = await db
    .select({
      signalId: signalResonances.signalId,
      resonanceCount: sql<number>`count(${signalResonances.id})`.mapWith(Number),
    })
    .from(signalResonances)
    .innerJoin(signals, eq(signalResonances.signalId, signals.id))
    .where(
      and(
        eq(signals.authorId, params.authorId),
        ne(signals.status, "DELETED"),
        gt(signalResonances.createdAt, params.since),
      ),
    )
    .groupBy(signalResonances.signalId)
    .orderBy(desc(sql<number>`count(${signalResonances.id})`));

  const newResonanceCount = rows.reduce((total, row) => {
    return total + row.resonanceCount;
  }, 0);
  const topRow = rows.reduce<(typeof rows)[number] | undefined>((current, row) => {
    if (current === undefined || row.resonanceCount > current.resonanceCount) {
      return row;
    }

    return current;
  }, undefined);

  if (topRow === undefined) {
    return {
      newResonanceCount,
    };
  }

  const topSignal = await findSignalById(topRow.signalId);

  return {
    newResonanceCount,
    topSignal,
  };
}

export async function deleteSignalResonance(params: {
  actorKey: string;
  signalId: string;
}): Promise<SignalResonanceResult> {
  return db.transaction(async (tx) => {
    const [signal] = await tx
      .select({
        resonanceCount: signals.resonanceCount,
      })
      .from(signals)
      .where(and(eq(signals.id, params.signalId), ...getPublicCompletedSignalFilters()))
      .limit(1);

    if (signal === undefined) {
      throw new SignalNotFoundForInteraction();
    }

    const [deleted] = await tx
      .delete(signalResonances)
      .where(
        and(
          eq(signalResonances.signalId, params.signalId),
          eq(signalResonances.actorKey, params.actorKey),
        ),
      )
      .returning({
        id: signalResonances.id,
      });

    if (deleted === undefined) {
      return {
        hasResonated: false,
        resonanceCount: signal.resonanceCount,
      };
    }

    const [updatedSignal] = await tx
      .update(signals)
      .set({
        resonanceCount: sql`greatest(${signals.resonanceCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(signals.id, params.signalId))
      .returning({
        resonanceCount: signals.resonanceCount,
      });

    return {
      hasResonated: false,
      resonanceCount: updatedSignal?.resonanceCount ?? Math.max(signal.resonanceCount - 1, 0),
    };
  });
}

export async function createSignalSave(params: {
  frequencyId: string;
  signalId: string;
}): Promise<{ hasSaved: true }> {
  return db.transaction(async (tx) => {
    const [signal] = await tx
      .select({
        id: signals.id,
      })
      .from(signals)
      .where(and(eq(signals.id, params.signalId), ...getPublicCompletedSignalFilters()))
      .limit(1);

    if (signal === undefined) {
      throw new SignalNotFoundForInteraction();
    }

    await tx
      .insert(signalSaves)
      .values({
        frequencyId: params.frequencyId,
        signalId: params.signalId,
      })
      .onConflictDoNothing({
        target: [signalSaves.frequencyId, signalSaves.signalId],
      });

    return {
      hasSaved: true,
    };
  });
}

export async function deleteSignalSave(params: {
  frequencyId: string;
  signalId: string;
}): Promise<{ hasSaved: false }> {
  await db
    .delete(signalSaves)
    .where(
      and(
        eq(signalSaves.frequencyId, params.frequencyId),
        eq(signalSaves.signalId, params.signalId),
      ),
    );

  return {
    hasSaved: false,
  };
}

export async function listSavedSignalsForFrequency(params: {
  frequencyId: string;
  limit: number;
}): Promise<SavedSignalRecord[]> {
  const rows = await db
    .select({
      ...signalSelection,
      savedAt: signalSaves.createdAt,
    })
    .from(signalSaves)
    .innerJoin(signals, eq(signalSaves.signalId, signals.id))
    .leftJoin(users, eq(signals.authorId, users.id))
    .where(and(eq(signalSaves.frequencyId, params.frequencyId), ...getPublicCompletedSignalFilters()))
    .orderBy(desc(signalSaves.createdAt))
    .limit(params.limit);

  return rows.map((row) => {
    return {
      ...toSignalRecord(row),
      savedAt: row.savedAt,
    };
  });
}

export async function listPublishedSignalEchoes(signalId: string): Promise<SignalEchoRecord[]> {
  return db
    .select({
      authorFreqCode: users.freqCode,
      authorId: signalEchoes.authorId,
      content: signalEchoes.content,
      createdAt: signalEchoes.createdAt,
      guestKey: signalEchoes.guestKey,
      id: signalEchoes.id,
      signalId: signalEchoes.signalId,
      status: signalEchoes.status,
      updatedAt: signalEchoes.updatedAt,
    })
    .from(signalEchoes)
    .leftJoin(users, eq(signalEchoes.authorId, users.id))
    .innerJoin(signals, eq(signalEchoes.signalId, signals.id))
    .where(
      and(
        eq(signalEchoes.signalId, signalId),
        eq(signalEchoes.status, "PUBLISHED"),
        ...getPublicCompletedSignalFilters(),
      ),
    )
    .orderBy(asc(signalEchoes.createdAt));
}
