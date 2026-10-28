CREATE TABLE "monthly_recaps" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frequency_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_count" integer NOT NULL,
	"summary" text NOT NULL,
	"theme_words" text[] NOT NULL,
	"top_signal_id" uuid,
	"total_resonance_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"year_month" varchar(7) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_recaps" ADD CONSTRAINT "monthly_recaps_frequency_id_frequencies_id_fk" FOREIGN KEY ("frequency_id") REFERENCES "public"."frequencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_recaps" ADD CONSTRAINT "monthly_recaps_top_signal_id_signals_id_fk" FOREIGN KEY ("top_signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_recaps_frequency_month_unique" ON "monthly_recaps" USING btree ("frequency_id","year_month");--> statement-breakpoint
CREATE INDEX "monthly_recaps_frequency_generated_at_idx" ON "monthly_recaps" USING btree ("frequency_id","generated_at");