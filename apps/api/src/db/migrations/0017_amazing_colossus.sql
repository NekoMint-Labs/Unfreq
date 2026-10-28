CREATE TABLE "signal_saves" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frequency_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theme_radio_days" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"ends_at" timestamp with time zone,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"theme" varchar(48) NOT NULL,
	"title" varchar(80) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_saves" ADD CONSTRAINT "signal_saves_frequency_id_frequencies_id_fk" FOREIGN KEY ("frequency_id") REFERENCES "public"."frequencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_saves" ADD CONSTRAINT "signal_saves_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_saves_frequency_signal_unique" ON "signal_saves" USING btree ("frequency_id","signal_id");--> statement-breakpoint
CREATE INDEX "signal_saves_frequency_created_at_idx" ON "signal_saves" USING btree ("frequency_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_saves_signal_created_at_idx" ON "signal_saves" USING btree ("signal_id","created_at");--> statement-breakpoint
CREATE INDEX "theme_radio_days_active_starts_at_idx" ON "theme_radio_days" USING btree ("is_active","starts_at");--> statement-breakpoint
CREATE INDEX "theme_radio_days_theme_idx" ON "theme_radio_days" USING btree ("theme");