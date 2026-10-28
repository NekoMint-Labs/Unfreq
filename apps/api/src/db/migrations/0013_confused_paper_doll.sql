CREATE TYPE "public"."signal_source" AS ENUM('ai_generated', 'human', 'seed');--> statement-breakpoint
ALTER TYPE "public"."target_type" ADD VALUE 'SIGNAL';--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "quality_reason" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "quality_score" integer;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "source" "signal_source" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "is_kept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "signals_source_created_at_idx" ON "signals" USING btree ("source","created_at");