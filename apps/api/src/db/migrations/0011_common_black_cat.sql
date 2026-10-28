CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "embedding" vector(1024);
--> statement-breakpoint
-- Add an ivfflat index when published signal volume grows past 500 rows.
-- CREATE INDEX CONCURRENTLY "signals_embedding_ivfflat_idx" ON "signals" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
