import postgres from "postgres";
import { env } from "../../config/env.js";
import type { AiSignalSchedulerConfig, AiSignalSchedulerRepository, SchedulerBatchClaim } from "./scheduler-types.js";

// A separate bounded pool lets shutdown cancel a blocked claim/ownership read
// instead of returning while an unbounded INSERT can still commit later.
export function configureAiSignalSchedulerRepository(config: Pick<AiSignalSchedulerConfig, "dbStatementTimeoutMs" | "dbLockTimeoutMs">): AiSignalSchedulerRepository {
  const client = postgres(env.databaseUrl, {
    infer: true,
    max: 1, prepare: false,
    connect_timeout: Math.ceil(env.healthDependencyTimeoutMs / 1000),
    connection: { statement_timeout: config.dbStatementTimeoutMs, lock_timeout: config.dbLockTimeoutMs },
  });
  return {
    async claim({ businessDate, ownerToken, config: batch }) {
      const rows = await client<SchedulerBatchClaim[]>`
        insert into ai_signal_scheduler_batches
          (job_key, business_date, time_zone, scheduled_time, owner_token, requested_count, signal_budget, dispatch_budget, deadline_at)
        values ('ai-signal-daily', ${businessDate}::date, ${batch.timeZone}, ${batch.scheduledTime}, ${ownerToken},
          ${batch.count}, ${batch.dailySignalBudget}, ${batch.dailyDispatchBudget},
          clock_timestamp() + ${batch.batchTimeoutMs} * interval '1 millisecond')
        on conflict (job_key, business_date) do nothing
        returning id, business_date::text as "businessDate", owner_token as "ownerToken", requested_count as "requestedCount"
      `;
      return rows[0];
    },
    async isActive(claim) {
      const rows = await client`select id from ai_signal_scheduler_batches where id = ${claim.id}
        and owner_token = ${claim.ownerToken} and status = 'RUNNING' and deadline_at > clock_timestamp()`;
      return rows.length === 1;
    },
    async reserveDispatch(claim) {
      const rows = await client`update ai_signal_scheduler_batches
        set dispatch_count = dispatch_count + 1, first_dispatch_at = coalesce(first_dispatch_at, clock_timestamp())
        where id = ${claim.id} and owner_token = ${claim.ownerToken} and status = 'RUNNING'
          and deadline_at > clock_timestamp() and dispatch_count < dispatch_budget returning id`;
      if (rows.length === 1) return "reserved";
      const active = await client`select dispatch_count, dispatch_budget from ai_signal_scheduler_batches
        where id = ${claim.id} and owner_token = ${claim.ownerToken} and status = 'RUNNING' and deadline_at > clock_timestamp()`;
      return active[0] && active[0].dispatch_count >= active[0].dispatch_budget ? "budget" : "obsolete";
    },
    async recordProgress(claim, progress) {
      const rows = await client`update ai_signal_scheduler_batches
        set accepted_count = ${progress.accepted}, rejected_count = ${progress.rejected}, generation_attempts = ${progress.attempts},
          result_signal_ids = ${JSON.stringify(progress.signalIds)}::jsonb
        where id = ${claim.id} and owner_token = ${claim.ownerToken} and status = 'RUNNING' and deadline_at > clock_timestamp() returning id`;
      return rows.length === 1;
    },
    async finish(claim, result) {
      const rows = await client`update ai_signal_scheduler_batches
        set status = ${result.status}, completed_at = clock_timestamp(), failure_code = ${result.failureCode ?? null},
          accepted_count = ${result.accepted}, rejected_count = ${result.rejected}, generation_attempts = ${result.attempts},
          result_signal_ids = ${JSON.stringify(result.signalIds)}::jsonb
        where id = ${claim.id} and owner_token = ${claim.ownerToken} and status = 'RUNNING'
          and (${result.status} <> 'COMPLETED' or deadline_at > clock_timestamp()) returning id`;
      return rows.length === 1;
    },
    async close(force = false) { await client.end({ timeout: force ? 0 : 5 }); },
  };
}
