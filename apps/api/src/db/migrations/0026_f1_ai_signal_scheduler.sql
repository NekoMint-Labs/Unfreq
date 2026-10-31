CREATE TABLE "ai_signal_scheduler_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" varchar(48) NOT NULL,
	"business_date" date NOT NULL,
	"time_zone" varchar(80) NOT NULL,
	"scheduled_time" varchar(5) NOT NULL,
	"owner_token" uuid NOT NULL,
	"status" varchar(12) DEFAULT 'RUNNING' NOT NULL,
	"requested_count" integer NOT NULL,
	"signal_budget" integer NOT NULL,
	"dispatch_budget" integer NOT NULL,
	"dispatch_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"generation_attempts" integer DEFAULT 0 NOT NULL,
	"result_signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"first_dispatch_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(32),
	CONSTRAINT "ai_signal_scheduler_status_check" CHECK ("ai_signal_scheduler_batches"."status" in ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
	CONSTRAINT "ai_signal_scheduler_budget_check" CHECK ("ai_signal_scheduler_batches"."requested_count" between 1 and 10 and "ai_signal_scheduler_batches"."signal_budget" between 1 and 10 and "ai_signal_scheduler_batches"."requested_count" <= "ai_signal_scheduler_batches"."signal_budget" and "ai_signal_scheduler_batches"."dispatch_budget" between 1 and 500 and "ai_signal_scheduler_batches"."dispatch_count" between 0 and "ai_signal_scheduler_batches"."dispatch_budget"),
	CONSTRAINT "ai_signal_scheduler_progress_check" CHECK ("ai_signal_scheduler_batches"."accepted_count" >= 0 and "ai_signal_scheduler_batches"."rejected_count" >= 0 and "ai_signal_scheduler_batches"."accepted_count" + "ai_signal_scheduler_batches"."rejected_count" <= "ai_signal_scheduler_batches"."requested_count" and "ai_signal_scheduler_batches"."generation_attempts" >= 0 and jsonb_typeof("ai_signal_scheduler_batches"."result_signal_ids") = 'array'),
	CONSTRAINT "ai_signal_scheduler_terminal_check" CHECK (("ai_signal_scheduler_batches"."status" = 'RUNNING' and "ai_signal_scheduler_batches"."completed_at" is null) or ("ai_signal_scheduler_batches"."status" <> 'RUNNING' and "ai_signal_scheduler_batches"."completed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_signal_scheduler_job_day_unique" ON "ai_signal_scheduler_batches" USING btree ("job_key","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_signal_scheduler_owner_unique" ON "ai_signal_scheduler_batches" USING btree ("owner_token");