ALTER TYPE "public"."notification_kind" ADD VALUE 'safety_review_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'event_safety_reconfirmation_required';--> statement-breakpoint
ALTER TABLE "safety_reviews" ADD COLUMN "refreshed_at" timestamp with time zone;