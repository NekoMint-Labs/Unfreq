CREATE TYPE "public"."daily_radio_report_status" AS ENUM('EMPTY', 'READY');--> statement-breakpoint
CREATE TABLE "daily_radio_reports" (
	"channel_highlights" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_line" text NOT NULL,
	"report_date" date NOT NULL,
	"source_counts" jsonb NOT NULL,
	"status" "daily_radio_report_status" DEFAULT 'READY' NOT NULL,
	"summary" text NOT NULL,
	"top_emotions" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_radio_reports_report_date_unique" ON "daily_radio_reports" USING btree ("report_date");--> statement-breakpoint
CREATE INDEX "daily_radio_reports_status_generated_at_idx" ON "daily_radio_reports" USING btree ("status","generated_at");