import { lstat, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { parsePublicationSnapshot } from "./publication.js";

export const replicaCategories = [
  "MATCH_LINK", "PROGRAM_SUMMARY", "CHILD_SIGNAL", "AI_REVIEW_TARGET", "AI_REVIEW_OPERATION",
  "MONTHLY_TOP_SIGNAL", "SAVE", "RESONANCE", "ECHO", "REPORT", "ADMIN_ACTION", "SCHEDULER_RESULT",
] as const;
const countSchema = z.union([z.string().regex(/^\d+$/u), z.number()]).transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value >= 0);
const rowSchema = z.strictObject({
  signal: z.strictObject({
    id: z.uuid(), status: z.enum(["DRAFT", "PUBLISHED", "REVIEWING", "HIDDEN", "DELETED"]),
    generationStatus: z.enum(["RECEIVED", "EXPANDING", "MATCHING", "WRITING", "COMPLETED", "FAILED"]),
    publicationVersion: z.number().int().nonnegative(), withdrawn: z.boolean(),
    publicationSnapshot: z.unknown(), hasEmbedding: z.boolean(), hasProgram: z.boolean(),
    audioStatus: z.enum(["NOT_REQUESTED", "PENDING", "READY", "FAILED"]),
    audioPublicationVersion: z.number().int().nonnegative().nullable(),
    audioKeys: z.strictObject({ main: z.string().nullable(), left: z.string().nullable(), right: z.string().nullable() }),
  }).nullable(),
  counts: z.record(z.enum(replicaCategories), countSchema),
  samples: z.array(z.strictObject({ category: z.enum(replicaCategories), id: z.uuid() })),
  unattributedAiReviewCount: countSchema,
});

export type SignalReplicaAudit = {
  signalId: string;
  readOnly: true;
  checkedAt: string;
  databaseSnapshot: "single-statement";
  signal: null | {
    id: string; status: string; generationStatus: string; publicationVersion: number;
    withdrawn: boolean; hasPublicationSnapshot: boolean; publicEligible: boolean;
    hasEmbedding: boolean; hasProgram: boolean; audioStatus: string;
    audioPublicationVersion: number | null;
  };
  counts: z.infer<typeof rowSchema>["counts"];
  samples: z.infer<typeof rowSchema>["samples"];
  sampleLimit: number;
  truncated: boolean;
  audio: Array<{ channel: "main" | "left" | "right"; state: "NOT_REFERENCED" | "PRESENT" | "MISSING" | "UNSAFE" | "UNVERIFIABLE" }>;
  unattributedAiReviewCount: number;
  limitations: readonly string[];
};

export const replicaAuditLimitations = [
  "References are evidence of links, not a complete list of copied text or permission to delete.",
  "matchSignalId has no copied publication version; program summary provenance cannot be reconstructed from text similarity.",
  "A parent link points to an independent authored work, not an automatically revocable copy.",
  "Monthly recaps persist only topSignalId, not all source signal IDs; non-top inputs cannot be fully traced.",
  "Unattributed AI reviews are counted globally and are not attributed to this signal; historical records are not backfilled.",
  "Scheduler result links prove the batch only; they do not attribute individual pre-persistence calls to a generated signal.",
  "Images have uploaderId but no signalId; no image association is inferred.",
  "Audio checks inspect only referenced safe filenames after the database snapshot; no directory scan, body read or atomic database/filesystem snapshot is performed.",
  "Logs, SQL snapshots, Redis persistence, browser/proxy caches and third-party Provider copies require separate inventories; absence here does not prove erasure.",
] as const;

async function inspectAudioKey(storageDirectory: string, key: string | null): Promise<SignalReplicaAudit["audio"][number]["state"]> {
  if (key === null) return "NOT_REFERENCED";
  // Current and legacy filenames only. Never follow an arbitrary stored path.
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (!new RegExp(`^${uuid}(?:-${uuid})?(?:-(?:main|left|right))?\\.mp3$`, "iu").test(key)) return "UNSAFE";
  try {
    const root = await realpath(resolve(storageDirectory));
    const target = resolve(root, key);
    if (!target.startsWith(`${root}${sep}`)) return "UNSAFE";
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) return "UNSAFE";
    const actual = await realpath(target);
    if (!actual.startsWith(`${root}${sep}`)) return "UNSAFE";
    return "PRESENT";
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? "MISSING" : "UNVERIFIABLE";
  }
}

export async function auditSignalReplicas(signalId: string, sampleLimit = 50,
  options: { audioStorageDirectory?: string } = {}): Promise<SignalReplicaAudit> {
  if (!z.uuid().safeParse(signalId).success) throw new Error("Signal replica audit requires a UUID.");
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 200) {
    throw new Error("Signal replica audit sample limit must be an integer from 1 to 200.");
  }
  // One read-only statement for database counts and bounded samples. No content
  // fields leave this module; the snapshot is parsed only to check eligibility.
  const [raw] = await db.execute(sql`
    with base as (
      select id::text, status::text, generation_status::text as "generationStatus",
        publication_version as "publicationVersion", withdrawn_at is not null as withdrawn,
        publication_snapshot as "publicationSnapshot", embedding is not null as "hasEmbedding",
        program_json <> '{}'::jsonb as "hasProgram", audio_status::text as "audioStatus",
        audio_publication_version as "audioPublicationVersion",
        jsonb_build_object('main', audio_storage_key, 'left', audio_storage_key_left, 'right', audio_storage_key_right) as "audioKeys"
      from signals where id = ${signalId}::uuid
    ), links as (
      select 'MATCH_LINK'::text as category, id::text from signals where match_signal_id = ${signalId}::uuid
      union all select 'PROGRAM_SUMMARY', id::text from signals where match_signal_id = ${signalId}::uuid
        and jsonb_typeof(program_json->'rightSignalSummary') = 'string' and length(program_json->>'rightSignalSummary') > 0
      union all select 'CHILD_SIGNAL', id::text from signals where parent_signal_id = ${signalId}::uuid
      union all select 'AI_REVIEW_TARGET', id::text from ai_reviews where target_type = 'SIGNAL' and target_id = ${signalId}::uuid
      union all select 'AI_REVIEW_OPERATION', id::text from ai_reviews where execution_json->'operation'->>'signalId' = ${signalId}
        and execution_json->'operation'->>'kind' = 'signal-generation' and execution_json->'operation'->>'schemaVersion' = '1'
      union all select 'MONTHLY_TOP_SIGNAL', id::text from monthly_recaps where top_signal_id = ${signalId}::uuid
      union all select 'SAVE', id::text from signal_saves where signal_id = ${signalId}::uuid
      union all select 'RESONANCE', id::text from signal_resonances where signal_id = ${signalId}::uuid
      union all select 'ECHO', id::text from signal_echoes where signal_id = ${signalId}::uuid
      union all select 'REPORT', id::text from reports where target_type = 'SIGNAL' and target_id = ${signalId}::uuid
      union all select 'ADMIN_ACTION', id::text from admin_actions where target_type = 'SIGNAL' and target_id = ${signalId}::uuid
      union all select 'SCHEDULER_RESULT', id::text from ai_signal_scheduler_batches where result_signal_ids ? ${signalId}
    ), categories(category) as (values ('MATCH_LINK'), ('PROGRAM_SUMMARY'), ('CHILD_SIGNAL'), ('AI_REVIEW_TARGET'),
      ('AI_REVIEW_OPERATION'), ('MONTHLY_TOP_SIGNAL'), ('SAVE'), ('RESONANCE'), ('ECHO'), ('REPORT'), ('ADMIN_ACTION'), ('SCHEDULER_RESULT')),
    counts as (select c.category, count(l.id)::text as total from categories c left join links l on l.category = c.category group by c.category),
    sample as (select category, id from links order by category, id limit ${sampleLimit})
    select (select to_jsonb(base) from base) as signal,
      (select jsonb_object_agg(category, total) from counts) as counts,
      coalesce((select jsonb_agg(to_jsonb(sample) order by category, id) from sample), '[]'::jsonb) as samples,
      (select count(*)::text from ai_reviews where target_id is null and execution_json->'operation' is null) as "unattributedAiReviewCount"
  `);
  const parsed = rowSchema.parse(raw);
  const total = Object.values(parsed.counts).reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(total) || parsed.samples.length > sampleLimit || parsed.samples.length > total) {
    throw new Error("Signal replica audit returned an inconsistent sample.");
  }
  const signal = parsed.signal;
  const validSnapshot = signal === null ? undefined : parsePublicationSnapshot(signal.publicationSnapshot);
  const audio = await Promise.all((["main", "left", "right"] as const).map(async (channel) => ({ channel,
    state: await inspectAudioKey(options.audioStorageDirectory ?? env.ttsStorageDir, signal?.audioKeys[channel] ?? null) })));
  return {
    signalId, readOnly: true, checkedAt: new Date().toISOString(), databaseSnapshot: "single-statement",
    signal: signal === null ? null : { id: signal.id, status: signal.status, generationStatus: signal.generationStatus,
      publicationVersion: signal.publicationVersion, withdrawn: signal.withdrawn,
      hasPublicationSnapshot: signal.publicationSnapshot !== null, publicEligible: signal.status === "PUBLISHED" &&
        signal.generationStatus === "COMPLETED" && !signal.withdrawn && signal.publicationVersion > 0 && validSnapshot !== undefined,
      hasEmbedding: signal.hasEmbedding, hasProgram: signal.hasProgram, audioStatus: signal.audioStatus,
      audioPublicationVersion: signal.audioPublicationVersion },
    counts: parsed.counts, samples: parsed.samples, sampleLimit, truncated: total > parsed.samples.length,
    audio, unattributedAiReviewCount: parsed.unattributedAiReviewCount, limitations: replicaAuditLimitations,
  };
}
