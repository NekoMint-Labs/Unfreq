CREATE TYPE "public"."provider_config_kind" AS ENUM('chat', 'embedding', 'reranker', 'tts');--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"api_key_ciphertext" text,
	"api_key_last4" varchar(4),
	"base_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"extra_json" jsonb,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "provider_config_kind" NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_kind_unique" ON "provider_configs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "provider_configs_updated_by_idx" ON "provider_configs" USING btree ("updated_by");