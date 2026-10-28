CREATE TYPE "public"."signal_audio_status" AS ENUM('FAILED', 'PENDING', 'READY');--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_error" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_status" "signal_audio_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_storage_key_left" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_storage_key_right" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_url_left" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_url_right" text;