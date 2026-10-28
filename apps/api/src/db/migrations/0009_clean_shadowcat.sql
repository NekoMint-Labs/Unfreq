CREATE TYPE "public"."signal_status" AS ENUM('DRAFT', 'PUBLISHED', 'REVIEWING', 'HIDDEN', 'DELETED');--> statement-breakpoint
CREATE TABLE "signal_echoes" (
	"author_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"guest_key" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"status" "echo_status" DEFAULT 'PUBLISHED' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"echo_count" integer DEFAULT 0 NOT NULL,
	"fingerprint_json" jsonb NOT NULL,
	"guest_key" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_signal_id" uuid,
	"program_json" jsonb NOT NULL,
	"raw_input" text NOT NULL,
	"resonance_count" integer DEFAULT 0 NOT NULL,
	"status" "signal_status" DEFAULT 'DRAFT' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "frequency_name" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_guest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "signal_echoes" ADD CONSTRAINT "signal_echoes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_echoes" ADD CONSTRAINT "signal_echoes_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_echoes_author_created_at_idx" ON "signal_echoes" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_echoes_signal_status_created_at_idx" ON "signal_echoes" USING btree ("signal_id","status","created_at");--> statement-breakpoint
CREATE INDEX "signals_author_created_at_idx" ON "signals" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_match_signal_id_idx" ON "signals" USING btree ("match_signal_id");--> statement-breakpoint
CREATE INDEX "signals_status_created_at_idx" ON "signals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_frequency_name_unique" ON "users" USING btree ("frequency_name");