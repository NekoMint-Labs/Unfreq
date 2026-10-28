CREATE TYPE "public"."bottle_status" AS ENUM('DRIFTING', 'RECEIVED', 'REPLIED', 'KEPT', 'REVIEWING', 'HIDDEN', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('MIDNIGHT', 'UNSENT', 'STARMAP');--> statement-breakpoint
CREATE TYPE "public"."echo_status" AS ENUM('PUBLISHED', 'REVIEWING', 'HIDDEN', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."limit_type" AS ENUM('VOICE_CREATE', 'BOTTLE_CREATE', 'BOTTLE_OPEN', 'SHORTWAVE_CREATE');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('PENDING', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('VOICE', 'ECHO', 'BOTTLE', 'BOTTLE_ECHO', 'USER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'MUTED', 'BANNED');--> statement-breakpoint
CREATE TYPE "public"."voice_status" AS ENUM('PUBLISHED', 'REVIEWING', 'HIDDEN', 'DELETED');