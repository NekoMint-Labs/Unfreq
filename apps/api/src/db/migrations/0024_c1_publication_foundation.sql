ALTER TABLE "signals" ADD COLUMN "audio_publication_version" integer;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "publication_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "publication_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_publication_version_check" CHECK ("signals"."publication_version" >= 0);--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_audio_publication_version_check" CHECK ("signals"."audio_publication_version" is null or "signals"."audio_publication_version" >= 0);