CREATE TABLE "daily_limits" (
	"count" integer DEFAULT 0 NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"limit_date" date NOT NULL,
	"limit_type" "limit_type" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voices" (
	"allow_echo" boolean DEFAULT true NOT NULL,
	"author_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"echo_count" integer DEFAULT 0 NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mood_tags" text[] NOT NULL,
	"resonance_count" integer DEFAULT 0 NOT NULL,
	"status" "voice_status" DEFAULT 'PUBLISHED' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_limits" ADD CONSTRAINT "daily_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voices" ADD CONSTRAINT "voices_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_limits_user_type_date_unique" ON "daily_limits" USING btree ("user_id","limit_type","limit_date");--> statement-breakpoint
CREATE INDEX "voices_author_created_at_idx" ON "voices" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "voices_channel_status_created_at_idx" ON "voices" USING btree ("channel","status","created_at");