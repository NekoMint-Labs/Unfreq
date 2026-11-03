import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { frequencies, users } from "../../db/schema.js";

export const identityMirrorFields = [
  "freqCode", "frequencyName", "passwordHash", "isGuest", "role", "status", "createdAt", "updatedAt",
] as const;

const countSchema = z.union([z.string().regex(/^\d+$/u), z.number()])
  .transform(Number).refine((value) => Number.isSafeInteger(value) && value >= 0);
const rowSchema = z.object({
  counts: z.object({
    users: countSchema, frequencies: countSchema, matching: countSchema,
    missingMirror: countSchema, orphanMirror: countSchema, fieldMismatch: countSchema,
  }).strict(),
  differences: z.array(z.object({
    id: z.uuid(),
    kind: z.enum(["MISSING_FREQUENCY", "ORPHAN_FREQUENCY", "FIELD_MISMATCH"]),
    fields: z.array(z.enum(identityMirrorFields)),
  }).strict()),
}).strict();

export type IdentityMirrorAudit = {
  authority: "users";
  checkedAt: string;
  readOnly: true;
  comparedFields: readonly string[];
  counts: z.infer<typeof rowSchema>["counts"];
  differences: z.infer<typeof rowSchema>["differences"];
  sampleLimit: number;
  truncated: boolean;
};

export async function auditIdentityMirrors(sampleLimit = 50): Promise<IdentityMirrorAudit> {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 200) {
    throw new Error("Identity audit sample limit must be an integer from 1 to 200.");
  }
  // One SELECT gives counts and samples the same PostgreSQL statement snapshot.
  // IS DISTINCT FROM keeps NULL and full timestamp precision meaningful. The
  // query never returns field values, email, device hashes or password hashes.
  const [raw] = await db.execute(sql`
    with joined as (
      select coalesce(u.id, f.id)::text as id,
        u.id is not null as has_user, f.id is not null as has_frequency,
        array_remove(array[
          case when u.freq_code is distinct from f.code then 'freqCode' end,
          case when u.frequency_name is distinct from f.frequency_name then 'frequencyName' end,
          case when u.password_hash is distinct from f.password_hash then 'passwordHash' end,
          case when u.is_guest is distinct from f.is_guest then 'isGuest' end,
          case when u.role is distinct from f.role then 'role' end,
          case when u.status::text is distinct from f.status::text then 'status' end,
          case when u.created_at is distinct from f.created_at then 'createdAt' end,
          case when u.updated_at is distinct from f.updated_at then 'updatedAt' end
        ], null) as fields
      from ${users} u full outer join ${frequencies} f on u.id = f.id
    ), counts as (
      select count(*) filter (where has_user)::text as users,
        count(*) filter (where has_frequency)::text as frequencies,
        count(*) filter (where has_user and has_frequency and cardinality(fields) = 0)::text as matching,
        count(*) filter (where has_user and not has_frequency)::text as "missingMirror",
        count(*) filter (where has_frequency and not has_user)::text as "orphanMirror",
        count(*) filter (where has_user and has_frequency and cardinality(fields) > 0)::text as "fieldMismatch"
      from joined
    ), sample as (
      select id,
        case when not has_frequency then 'MISSING_FREQUENCY'
          when not has_user then 'ORPHAN_FREQUENCY' else 'FIELD_MISMATCH' end as kind,
        case when has_user and has_frequency then fields else array[]::text[] end as fields
      from joined where not has_user or not has_frequency or cardinality(fields) > 0
      order by id limit ${sampleLimit}
    )
    select to_jsonb(counts) as counts,
      coalesce((select jsonb_agg(to_jsonb(sample) order by id) from sample), '[]'::jsonb) as differences
    from counts
  `);
  const parsed = rowSchema.parse(raw);
  const differenceCount = parsed.counts.missingMirror + parsed.counts.orphanMirror + parsed.counts.fieldMismatch;
  if (parsed.differences.length > sampleLimit || parsed.differences.length > differenceCount) {
    throw new Error("Identity audit returned an inconsistent sample.");
  }
  return {
    authority: "users", checkedAt: new Date().toISOString(), readOnly: true,
    comparedFields: identityMirrorFields, counts: parsed.counts, differences: parsed.differences,
    sampleLimit, truncated: differenceCount > parsed.differences.length,
  };
}
