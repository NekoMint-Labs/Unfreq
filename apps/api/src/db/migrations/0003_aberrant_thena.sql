CREATE TABLE "echoes" (
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "echo_status" DEFAULT 'PUBLISHED' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voice_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resonances" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"voice_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "echoes" ADD CONSTRAINT "echoes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echoes" ADD CONSTRAINT "echoes_voice_id_voices_id_fk" FOREIGN KEY ("voice_id") REFERENCES "public"."voices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resonances" ADD CONSTRAINT "resonances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resonances" ADD CONSTRAINT "resonances_voice_id_voices_id_fk" FOREIGN KEY ("voice_id") REFERENCES "public"."voices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "echoes_author_created_at_idx" ON "echoes" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "echoes_voice_status_created_at_idx" ON "echoes" USING btree ("voice_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resonances_user_voice_unique" ON "resonances" USING btree ("user_id","voice_id");--> statement-breakpoint
CREATE INDEX "resonances_voice_created_at_idx" ON "resonances" USING btree ("voice_id","created_at");