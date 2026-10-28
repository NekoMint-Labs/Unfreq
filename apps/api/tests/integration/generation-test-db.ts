import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
export type RetryHistory = {
  phase: string; attempt_count: number; attempt_id: string | null;
  started_ms: number | null; due_ms: number | null;
};

// The caller already proved ownership of a fresh, per-case database. These
// fixed DDL objects only inject a real failing UPDATE and observe commits.
export async function installDispatchFault(sql: Sql, authorId: string, mode: "twice" | "always") {
  await sql.unsafe(`
    create table generation_test_dispatch_fault (author_id uuid primary key, fail_count integer not null);
    create sequence generation_test_fault_sequence;
    create table generation_test_retry_history (
      ordinal bigserial primary key, phase text not null, attempt_count integer not null, attempt_id uuid,
      started_at timestamptz, due_at timestamptz
    );
    create function generation_test_fail_dispatch() returns trigger language plpgsql as $$
    declare failures integer; ordinal bigint;
    begin
      select fail_count into failures from generation_test_dispatch_fault where author_id = NEW.author_id;
      if found and OLD.generation_dispatch_started_at is null and NEW.generation_dispatch_started_at is not null then
        ordinal := nextval('generation_test_fault_sequence');
        if failures < 0 or ordinal <= failures then
          raise exception using errcode = '40001', message = 'SYNTHETIC_PREDISPATCH_FAILURE';
        end if;
      end if;
      return NEW;
    end $$;
    create trigger generation_test_fail_dispatch before update on signals
      for each row execute function generation_test_fail_dispatch();
    create function generation_test_audit_retry() returns trigger language plpgsql as $$
    begin
      if exists(select 1 from generation_test_dispatch_fault where author_id = NEW.author_id)
        and OLD.generation_status is distinct from NEW.generation_status
        and NEW.generation_status in ('RECEIVED','EXPANDING','FAILED') then
        insert into generation_test_retry_history (phase, attempt_count, attempt_id, started_at, due_at) values
          (NEW.generation_status::text, NEW.generation_attempt_count, NEW.generation_attempt_id,
           NEW.generation_attempt_started_at, NEW.generation_next_attempt_at);
      end if;
      return NEW;
    end $$;
    create trigger generation_test_audit_retry after update on signals
      for each row execute function generation_test_audit_retry();
  `);
  await sql`insert into generation_test_dispatch_fault values (${authorId}::uuid, ${mode === "twice" ? 2 : -1})`;
}

export async function readRetryHistory(sql: Sql): Promise<RetryHistory[]> {
  return Array.from(await sql<RetryHistory[]>`
    select phase, attempt_count, attempt_id,
      (extract(epoch from started_at) * 1000)::double precision as started_ms,
      (extract(epoch from due_at) * 1000)::double precision as due_ms
    from generation_test_retry_history order by ordinal
  `);
}
