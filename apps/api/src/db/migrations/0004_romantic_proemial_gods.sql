CREATE TABLE "admin_actions" (
	"action" text NOT NULL,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reviews" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_text" text NOT NULL,
	"model" text NOT NULL,
	"output_json" jsonb NOT NULL,
	"provider" text NOT NULL,
	"review_type" text NOT NULL,
	"status" text NOT NULL,
	"target_id" uuid,
	"target_type" "target_type"
);
--> statement-breakpoint
CREATE TABLE "bottle_echoes" (
	"author_id" uuid NOT NULL,
	"bottle_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "echo_status" DEFAULT 'PUBLISHED' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bottles" (
	"allow_echo" boolean DEFAULT true NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kept_at" timestamp with time zone,
	"kept_by_id" uuid,
	"opened_at" timestamp with time zone,
	"opened_by_id" uuid,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"status" "bottle_status" DEFAULT 'DRIFTING' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note" text,
	"reason" text NOT NULL,
	"reporter_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolution" text,
	"status" "report_status" DEFAULT 'PENDING' NOT NULL,
	"target_id" uuid NOT NULL,
	"target_type" "target_type" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bottle_echoes" ADD CONSTRAINT "bottle_echoes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bottle_echoes" ADD CONSTRAINT "bottle_echoes_bottle_id_bottles_id_fk" FOREIGN KEY ("bottle_id") REFERENCES "public"."bottles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bottles" ADD CONSTRAINT "bottles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bottles" ADD CONSTRAINT "bottles_kept_by_id_users_id_fk" FOREIGN KEY ("kept_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bottles" ADD CONSTRAINT "bottles_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_actions_admin_created_at_idx" ON "admin_actions" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_actions_target_type_target_id_idx" ON "admin_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ai_reviews_review_type_created_at_idx" ON "ai_reviews" USING btree ("review_type","created_at");--> statement-breakpoint
CREATE INDEX "ai_reviews_target_type_target_id_idx" ON "ai_reviews" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "bottle_echoes_author_created_at_idx" ON "bottle_echoes" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "bottle_echoes_bottle_status_created_at_idx" ON "bottle_echoes" USING btree ("bottle_id","status","created_at");--> statement-breakpoint
CREATE INDEX "bottles_author_created_at_idx" ON "bottles" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "bottles_opened_by_created_at_idx" ON "bottles" USING btree ("opened_by_id","created_at");--> statement-breakpoint
CREATE INDEX "bottles_status_created_at_idx" ON "bottles" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_reporter_created_at_idx" ON "reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_type_target_id_idx" ON "reports" USING btree ("target_type","target_id");