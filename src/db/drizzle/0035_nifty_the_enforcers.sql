ALTER TYPE "public"."event_registration_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'event_registered';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'registration_threshold_reached';