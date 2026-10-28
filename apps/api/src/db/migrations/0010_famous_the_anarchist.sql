CREATE TABLE "signal_resonances" (
	"actor_key" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"guest_key" text,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_resonances" ADD CONSTRAINT "signal_resonances_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_resonances" ADD CONSTRAINT "signal_resonances_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_resonances_author_created_at_idx" ON "signal_resonances" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_resonances_signal_created_at_idx" ON "signal_resonances" USING btree ("signal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_resonances_signal_actor_unique" ON "signal_resonances" USING btree ("signal_id","actor_key");