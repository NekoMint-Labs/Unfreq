ALTER TABLE "signals" ALTER COLUMN "embedding" SET DATA TYPE vector;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "embedding_dimensions" integer;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "embedding_provider" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "embedding_version" text;