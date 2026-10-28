CREATE TYPE "public"."signal_primary_band" AS ENUM('self_mirror', 'emotional_undercurrent', 'relationship_nebula', 'time_ring', 'meaning_deep_space', 'stagnant_orbit', 'era_cluster');--> statement-breakpoint
CREATE TYPE "public"."signal_sub_feeling" AS ENUM('self_doubt', 'identity_confusion', 'self_acceptance', 'fatigue', 'anxiety', 'numbness', 'loneliness', 'need_to_be_understood', 'relationship_disappointment', 'growth_anxiety', 'nostalgia', 'future_uncertainty', 'effort_doubt', 'goal_loss', 'existential_questioning', 'procrastination', 'starting_difficulty', 'fear_of_failure', 'efficiency_anxiety', 'work_alienation', 'modern_loneliness');--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "core_need" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "emotion_tone" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "inner_conflict" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "primary_band" "signal_primary_band";--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "resonance_keywords" jsonb;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "sub_feeling" "signal_sub_feeling";--> statement-breakpoint
CREATE INDEX "signals_primary_band_status_created_at_idx" ON "signals" USING btree ("primary_band","status","created_at");