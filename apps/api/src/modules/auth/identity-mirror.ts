import { sql } from "drizzle-orm";
import type { db } from "../../db/client.js";
import { frequencies, users } from "../../db/schema.js";

export type IdentityTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller must first write or lock the authoritative users row in this transaction. */
export async function syncFrequencyMirror(transaction: IdentityTransaction, userId: string): Promise<void> {
  // Copy inside PostgreSQL: JS Date would truncate default now() microseconds.
  // Status columns use different enum types; only explicitly mirrored columns
  // are updated, preserving frequency-only observation fields.
  await transaction.execute(sql`
    insert into ${frequencies}
      (id, code, frequency_name, password_hash, is_guest, role, status, created_at, updated_at)
    select id, freq_code, frequency_name, password_hash, is_guest, role,
      status::text::frequency_status, created_at, updated_at
    from ${users} where id = ${userId}
    on conflict (id) do update set
      code = excluded.code,
      frequency_name = excluded.frequency_name,
      password_hash = excluded.password_hash,
      is_guest = excluded.is_guest,
      role = excluded.role,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
}
