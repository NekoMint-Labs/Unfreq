CREATE TYPE "public"."frequency_status" AS ENUM('ACTIVE', 'MUTED', 'BANNED');--> statement-breakpoint
ALTER TYPE "public"."signal_audio_status" RENAME TO "signal_audio_status_old";--> statement-breakpoint
CREATE TYPE "public"."signal_audio_status" AS ENUM('FAILED', 'NOT_REQUESTED', 'PENDING', 'READY');--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "audio_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "audio_status" SET DATA TYPE "public"."signal_audio_status" USING "audio_status"::text::"public"."signal_audio_status";--> statement-breakpoint
DROP TYPE "public"."signal_audio_status_old";--> statement-breakpoint
CREATE TABLE "frequencies" (
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_hash" text,
	"frequency_name" varchar(32),
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_guest" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"password_hash" text,
	"role" "role" DEFAULT 'USER' NOT NULL,
	"status" "frequency_status" DEFAULT 'ACTIVE' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "audio_status" SET DEFAULT 'NOT_REQUESTED';--> statement-breakpoint
ALTER TABLE "signal_resonances" ADD COLUMN "frequency_id" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_storage_key" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "audio_url" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "expanded_text" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "follow_up_question" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "frequency_id" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "galaxy_position" jsonb;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "parent_signal_id" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "seed_text" text;--> statement-breakpoint
INSERT INTO "frequencies" (
	"id",
	"code",
	"frequency_name",
	"password_hash",
	"is_guest",
	"role",
	"status",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	replace("freq_code", 'FM-', 'FM '),
	"frequency_name",
	"password_hash",
	"is_guest",
	"role",
	CASE
		WHEN "status" = 'ACTIVE' THEN 'ACTIVE'::"frequency_status"
		WHEN "status" = 'MUTED' THEN 'MUTED'::"frequency_status"
		ELSE 'BANNED'::"frequency_status"
	END,
	"created_at",
	"updated_at"
FROM "users"
;--> statement-breakpoint
UPDATE "users"
SET "freq_code" = replace("freq_code", 'FM-', 'FM ')
WHERE "freq_code" LIKE 'FM-%';--> statement-breakpoint
UPDATE "signals"
SET
	"frequency_id" = "author_id",
	"seed_text" = "raw_input",
	"expanded_text" = COALESCE(
		"program_json" ->> 'leftSignalSummary',
		"program_json" ->> 'hostIntro',
		"raw_input"
	),
	"follow_up_question" = COALESCE(
		"program_json" ->> 'closingQuestion',
		"fingerprint_json" ->> 'hiddenNeed'
	),
	"audio_storage_key" = COALESCE("audio_storage_key_left", "audio_storage_key_right"),
	"audio_url" = COALESCE("audio_url_left", "audio_url_right")
WHERE "seed_text" IS NULL OR "expanded_text" IS NULL;--> statement-breakpoint
UPDATE "signal_resonances"
SET "frequency_id" = "author_id"
WHERE "frequency_id" IS NULL AND "author_id" IS NOT NULL;--> statement-breakpoint
UPDATE "signals"
SET "audio_status" = 'NOT_REQUESTED'
WHERE
	"audio_status" = 'PENDING'
	AND "audio_storage_key_left" IS NULL
	AND "audio_storage_key_right" IS NULL
	AND "audio_url_left" IS NULL
	AND "audio_url_right" IS NULL;--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "expanded_text" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "seed_text" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "frequencies_code_unique" ON "frequencies" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "frequencies_frequency_name_unique" ON "frequencies" USING btree ("frequency_name");--> statement-breakpoint
CREATE INDEX "frequencies_device_hash_idx" ON "frequencies" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "frequencies_status_idx" ON "frequencies" USING btree ("status");--> statement-breakpoint
ALTER TABLE "signal_resonances" ADD CONSTRAINT "signal_resonances_frequency_id_frequencies_id_fk" FOREIGN KEY ("frequency_id") REFERENCES "public"."frequencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_frequency_id_frequencies_id_fk" FOREIGN KEY ("frequency_id") REFERENCES "public"."frequencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_parent_signal_id_signals_id_fk" FOREIGN KEY ("parent_signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_resonances_frequency_created_at_idx" ON "signal_resonances" USING btree ("frequency_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_frequency_created_at_idx" ON "signals" USING btree ("frequency_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_parent_signal_id_idx" ON "signals" USING btree ("parent_signal_id");
