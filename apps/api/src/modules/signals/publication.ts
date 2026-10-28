import { createHash } from "node:crypto";
import { z } from "zod";
import { maxSignalPublicationVersion } from "@unfreq/contracts/signals";
import type {
  PublicGalaxySignalPoint,
  PublicSavedSignalSummary,
  PublicSignalDetail,
  PublicSignalMatchSummary,
  SignalGalaxyPosition,
  SignalGenerationStatus,
  SignalPublicationPreview,
  SignalPublicationSnapshot,
  SignalPublicContent,
  SignalStatus,
} from "@unfreq/contracts/signals";
import { signalBandLabels, signalPrimaryBands } from "./frequency-taxonomy.js";
import type { SignalRecord } from "./types.js";

const versionSchema = z.number().int().min(0).max(maxSignalPublicationVersion);
const publicVersionSchema = versionSchema.min(1);
const nonblankTextSchema = z.string().min(1).refine((text) => text.trim().length > 0);
// These are existing preview labels, never newly inferred text or a full profile.
const tagSchema = z.string().min(1).max(16).refine((tag) => tag === tag.trim());
const frequencyCodeSchema = z.string().regex(/^FM[ -]\d{2}\.\d{2}$/u);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const signalPublicContentSchema = z.strictObject({
  expandedText: nonblankTextSchema,
  authorFreqCode: frequencyCodeSchema.optional(),
  tags: z.array(tagSchema).max(3).refine((tags) => new Set(tags).size === tags.length),
  primaryBand: z.enum(signalPrimaryBands).optional(),
}).refine(
  (content) => content.primaryBand === undefined ||
    content.tags.includes(signalBandLabels[content.primaryBand]),
  { message: "A public band must have its display label among the confirmed tags." },
);

/** Stable key order, explicit optional-field omission, and exact approved text bytes. */
function canonicalContentDigest(parsed: SignalPublicContent): string {
  const canonical = JSON.stringify({
    expandedText: parsed.expandedText,
    ...(parsed.authorFreqCode === undefined ? {} : { authorFreqCode: parsed.authorFreqCode }),
    tags: parsed.tags,
    ...(parsed.primaryBand === undefined ? {} : { primaryBand: parsed.primaryBand }),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function digestPublicationContent(content: SignalPublicContent): string {
  return canonicalContentDigest(signalPublicContentSchema.parse(content));
}

export const signalPublicationPreviewSchema = z.strictObject({
  content: signalPublicContentSchema,
  digest: digestSchema,
  version: versionSchema,
}).refine((preview) => preview.digest === canonicalContentDigest(preview.content), {
  message: "Publication content digest does not match.",
});

export const signalPublicationSnapshotSchema = z.strictObject({
  kind: z.literal("AUTHOR_CONFIRMED"),
  confirmedAt: z.iso.datetime({ offset: true }),
  content: signalPublicContentSchema,
  digest: digestSchema,
}).refine((snapshot) => snapshot.digest === canonicalContentDigest(snapshot.content), {
  message: "Publication content digest does not match.",
});

export type PublicationPreviewInput = Pick<SignalRecord,
  "authorId" | "authorFreqCode" | "expandedText" | "fingerprintJson" |
  "generationStatus" | "primaryBand"
>;

/** Private candidate only. The caller must authenticate the owner and display every field. */
export function buildPublicationPreview(
  signal: PublicationPreviewInput,
  version: number,
): SignalPublicationPreview {
  if (signal.authorId === null || signal.authorId.trim().length === 0 ||
    signal.authorFreqCode === null || signal.generationStatus !== "COMPLETED") {
    throw new Error("Publication preview is unavailable.");
  }
  const primaryBand = signal.primaryBand ?? signal.fingerprintJson.primaryBand;
  // No profile normalizer: it can infer labels from private Seed or analysis.
  const tags = [...new Set([
    signalBandLabels[primaryBand],
    ...signal.fingerprintJson.tags.slice(0, 2).map((tag) => tag.trim())
      .filter((tag) => tag.length > 0 && tag.length <= 16),
  ])];
  const content = signalPublicContentSchema.parse({
    expandedText: signal.expandedText,
    authorFreqCode: signal.authorFreqCode,
    tags,
    primaryBand,
  });
  return signalPublicationPreviewSchema.parse({
    content,
    digest: digestPublicationContent(content),
    version,
  });
}

/** Call only after explicit author confirmation and a transactional candidate/version check. */
export function confirmPublicationSnapshot(
  preview: SignalPublicationPreview,
  confirmedAt: Date,
): SignalPublicationSnapshot {
  const parsed = signalPublicationPreviewSchema.parse(preview);
  return signalPublicationSnapshotSchema.parse({
    kind: "AUTHOR_CONFIRMED",
    confirmedAt: confirmedAt.toISOString(),
    content: parsed.content,
    digest: parsed.digest,
  });
}

/** Unknown, legacy, extra-field or tampered values never become confirmation evidence. */
export function parsePublicationSnapshot(value: unknown): SignalPublicationSnapshot | undefined {
  try {
    const result = signalPublicationSnapshotSchema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export const validatePublicationSnapshot = parsePublicationSnapshot;

export type PublicationProjectionState = {
  status: SignalStatus;
  generationStatus: SignalGenerationStatus;
  withdrawnAt: Date | null;
  currentPublicationVersion: number;
  expectedPublicationVersion: number;
};

const projectionStateSchema = z.strictObject({
  status: z.literal("PUBLISHED"),
  generationStatus: z.literal("COMPLETED"),
  withdrawnAt: z.null(),
  currentPublicationVersion: publicVersionSchema,
  expectedPublicationVersion: publicVersionSchema,
}).refine((state) => state.currentPublicationVersion === state.expectedPublicationVersion);

type PublicMetadata = Pick<SignalRecord,
  "id" | "createdAt" | "resonanceCount" | "source"
>;
type ProjectionInput<Metadata extends PublicMetadata = PublicMetadata> = {
  signal: Metadata;
  snapshot: unknown;
  state: PublicationProjectionState;
};

const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sourceSchema = z.enum(["human", "seed", "ai_generated"]);
const idSchema = z.uuid();
const positionSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const publicMatchSchema = z.strictObject({
  expandedText: nonblankTextSchema,
  authorFreqCode: frequencyCodeSchema.optional(),
  tags: z.array(tagSchema).max(3).refine((tags) => new Set(tags).size === tags.length),
  primaryBand: z.enum(signalPrimaryBands).optional(),
  id: idSchema,
  score: z.number().finite().min(0),
  source: z.enum(["PUBLISHED", "SEEDED", "FALLBACK"]),
  resonanceCount: countSchema,
  publicationVersion: publicVersionSchema,
}).refine((match) => signalPublicContentSchema.safeParse({
  expandedText: match.expandedText,
  authorFreqCode: match.authorFreqCode,
  tags: match.tags,
  primaryBand: match.primaryBand,
}).success);

function projectionBasis(input: ProjectionInput) {
  const state = projectionStateSchema.safeParse(input.state);
  const snapshot = parsePublicationSnapshot(input.snapshot);
  const metadata = z.strictObject({
    id: idSchema,
    createdAt: z.date(),
    resonanceCount: countSchema,
    source: sourceSchema,
  }).safeParse({
    id: input.signal.id,
    createdAt: input.signal.createdAt,
    resonanceCount: input.signal.resonanceCount,
    source: input.signal.source,
  });
  if (!state.success || snapshot === undefined || !metadata.success) return undefined;
  return { state: state.data, snapshot, metadata: metadata.data };
}

function publicContent(content: SignalPublicContent): SignalPublicContent {
  return {
    expandedText: content.expandedText,
    ...(content.authorFreqCode === undefined ? {} : { authorFreqCode: content.authorFreqCode }),
    tags: [...content.tags],
    ...(content.primaryBand === undefined ? {} : { primaryBand: content.primaryBand }),
  };
}

/**
 * Pure whitelist only: it cannot prove a database recheck occurred. Queries must
 * recheck current public eligibility/epoch after async work, including each match.
 * A retained confirmation survives withdrawal/moderation epoch changes.
 */
export function projectPublicSignal(input: ProjectionInput<PublicMetadata &
  Pick<SignalRecord, "echoCount" | "updatedAt">> & {
  hasSaved?: boolean;
  matches?: readonly PublicSignalMatchSummary[];
}): PublicSignalDetail | undefined {
  const basis = projectionBasis(input);
  const extra = z.strictObject({
    updatedAt: z.date(), echoCount: countSchema, hasSaved: z.boolean().optional(),
    matches: z.array(publicMatchSchema),
  }).safeParse({
    updatedAt: input.signal.updatedAt,
    echoCount: input.signal.echoCount,
    hasSaved: input.hasSaved,
    matches: input.matches ?? [],
  });
  if (basis === undefined || !extra.success) return undefined;
  return {
    ...publicContent(basis.snapshot.content),
    id: basis.metadata.id,
    createdAt: basis.metadata.createdAt.toISOString(),
    updatedAt: extra.data.updatedAt.toISOString(),
    publishedAt: basis.snapshot.confirmedAt,
    publicationVersion: basis.state.currentPublicationVersion,
    status: "PUBLISHED",
    visibility: "PUBLIC",
    echoCount: extra.data.echoCount,
    resonanceCount: basis.metadata.resonanceCount,
    source: basis.metadata.source,
    ...(extra.data.hasSaved === undefined ? {} : { hasSaved: extra.data.hasSaved }),
    matches: extra.data.matches.map((match) => ({
      ...publicContent(match),
      id: match.id,
      score: match.score,
      source: match.source,
      resonanceCount: match.resonanceCount,
      publicationVersion: match.publicationVersion,
    })),
  };
}

export function projectPublicMatch(
  input: ProjectionInput & { score: number },
): PublicSignalMatchSummary | undefined {
  const basis = projectionBasis(input);
  const score = z.number().finite().min(0).safeParse(input.score);
  if (basis === undefined || !score.success) return undefined;
  return {
    ...publicContent(basis.snapshot.content),
    id: basis.metadata.id,
    score: score.data,
    source: "PUBLISHED",
    resonanceCount: basis.metadata.resonanceCount,
    publicationVersion: basis.state.currentPublicationVersion,
  };
}

export function projectPublicSaved(
  input: ProjectionInput<PublicMetadata & { savedAt: Date }>,
): PublicSavedSignalSummary | undefined {
  const basis = projectionBasis(input);
  const savedAt = z.date().safeParse(input.signal.savedAt);
  if (basis === undefined || !savedAt.success) return undefined;
  return {
    ...publicContent(basis.snapshot.content),
    id: basis.metadata.id,
    createdAt: basis.metadata.createdAt.toISOString(),
    savedAt: savedAt.data.toISOString(),
    publicationVersion: basis.state.currentPublicationVersion,
    status: "PUBLISHED",
    resonanceCount: basis.metadata.resonanceCount,
    source: basis.metadata.source,
  };
}

export function projectPublicGalaxy(input: ProjectionInput & {
  position: SignalGalaxyPosition;
  isMine: boolean;
  matchIds: readonly string[];
  visibleSignalIds: ReadonlySet<string>;
}): PublicGalaxySignalPoint | undefined {
  const basis = projectionBasis(input);
  const extra = z.strictObject({
    position: positionSchema, isMine: z.boolean(), matchIds: z.array(idSchema),
  }).safeParse({
    position: input.position, isMine: input.isMine, matchIds: input.matchIds,
  });
  if (basis === undefined || !extra.success || input.visibleSignalIds === undefined) return undefined;
  return {
    ...publicContent(basis.snapshot.content),
    id: basis.metadata.id,
    createdAt: basis.metadata.createdAt.toISOString(),
    publicationVersion: basis.state.currentPublicationVersion,
    position: { x: extra.data.position.x, y: extra.data.position.y, z: extra.data.position.z },
    source: basis.metadata.source,
    isMine: extra.data.isMine,
    matchIds: [...new Set(extra.data.matchIds)].filter((id) =>
      id !== basis.metadata.id && input.visibleSignalIds.has(id)),
    resonanceCount: basis.metadata.resonanceCount,
  };
}
