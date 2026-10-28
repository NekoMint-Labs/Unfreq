CREATE TYPE "public"."signal_generation_status" AS ENUM('RECEIVED', 'EXPANDING', 'MATCHING', 'WRITING', 'COMPLETED', 'FAILED');--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_error" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "generation_status" "signal_generation_status" DEFAULT 'COMPLETED' NOT NULL;--> statement-breakpoint
CREATE INDEX "signals_generation_status_created_at_idx" ON "signals" USING btree ("generation_status","created_at");