ALTER TABLE "signals" ADD COLUMN "generation_attempt_count" integer;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_attempt_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_attempt_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_dispatch_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "signals_generation_queue_idx" ON "signals" USING btree ("generation_next_attempt_at","created_at","id") WHERE "signals"."generation_attempt_count" is not null and "signals"."generation_status" = 'RECEIVED';--> statement-breakpoint
CREATE INDEX "signals_generation_lease_idx" ON "signals" USING btree ("generation_lease_until") WHERE "signals"."generation_attempt_count" is not null and "signals"."generation_lease_until" is not null;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_generation_execution_check" CHECK (
      (
        "signals"."generation_attempt_count" is null
        and "signals"."generation_attempt_id" is null and "signals"."generation_lease_owner" is null
        and "signals"."generation_lease_until" is null and "signals"."generation_attempt_started_at" is null
        and "signals"."generation_attempt_deadline_at" is null and "signals"."generation_next_attempt_at" is null
        and "signals"."generation_dispatch_started_at" is null
      ) or (
        "signals"."generation_attempt_count" is not null and "signals"."generation_attempt_count" >= 0
        and (
          (
            "signals"."generation_status" = 'RECEIVED' and "signals"."status" = 'DRAFT'
            and "signals"."generation_error" is null and "signals"."generation_next_attempt_at" is not null
            and "signals"."generation_attempt_id" is null and "signals"."generation_lease_owner" is null
            and "signals"."generation_lease_until" is null and "signals"."generation_attempt_started_at" is null
            and "signals"."generation_attempt_deadline_at" is null and "signals"."generation_dispatch_started_at" is null
          ) or (
            "signals"."generation_status" in ('EXPANDING', 'MATCHING', 'WRITING') and "signals"."status" = 'DRAFT'
            and "signals"."generation_error" is null and "signals"."generation_attempt_count" >= 1
            and "signals"."generation_next_attempt_at" is null
            and "signals"."generation_attempt_id" is not null and "signals"."generation_lease_owner" is not null
            and "signals"."generation_lease_until" is not null and "signals"."generation_attempt_started_at" is not null
            and "signals"."generation_attempt_deadline_at" is not null
            and "signals"."generation_attempt_started_at" < "signals"."generation_lease_until"
            and "signals"."generation_lease_until" <= "signals"."generation_attempt_deadline_at"
            and ("signals"."generation_dispatch_started_at" is null or (
              "signals"."generation_dispatch_started_at" is not null
              and "signals"."generation_dispatch_started_at" >= "signals"."generation_attempt_started_at"
              and "signals"."generation_dispatch_started_at" <= "signals"."generation_attempt_deadline_at"
            ))
          ) or (
            "signals"."generation_status" in ('COMPLETED', 'FAILED')
            and "signals"."generation_lease_owner" is null and "signals"."generation_lease_until" is null
            and "signals"."generation_next_attempt_at" is null
            and (("signals"."generation_status" = 'COMPLETED' and "signals"."generation_error" is null)
              or ("signals"."generation_status" = 'FAILED' and "signals"."generation_error" is not null))
            and (
              ("signals"."generation_status" = 'FAILED'
                and "signals"."generation_attempt_id" is null and "signals"."generation_attempt_started_at" is null
                and "signals"."generation_attempt_deadline_at" is null and "signals"."generation_dispatch_started_at" is null)
              or (
                "signals"."generation_attempt_count" >= 1 and "signals"."generation_attempt_id" is not null
                and "signals"."generation_attempt_started_at" is not null and "signals"."generation_attempt_deadline_at" is not null
                and "signals"."generation_attempt_started_at" < "signals"."generation_attempt_deadline_at"
                and ("signals"."generation_dispatch_started_at" is null or (
                  "signals"."generation_dispatch_started_at" is not null
                  and "signals"."generation_dispatch_started_at" >= "signals"."generation_attempt_started_at"
                  and "signals"."generation_dispatch_started_at" <= "signals"."generation_attempt_deadline_at"
                ))
              )
            )
          )
        )
      )
    );