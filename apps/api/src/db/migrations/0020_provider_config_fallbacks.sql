ALTER TABLE "provider_configs" ADD COLUMN "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
DROP INDEX "provider_configs_kind_unique";--> statement-breakpoint
CREATE INDEX "provider_configs_kind_priority_idx" ON "provider_configs" USING btree ("kind","priority");
