ALTER TYPE "public"."equipment_arrangement_status" ADD VALUE 'not_required';--> statement-breakpoint
ALTER TYPE "public"."equipment_arrangement_status" ADD VALUE 'unavailable';--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "arrangement_notes" text;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_unavailable_has_reason" CHECK ("equipment_requests"."arrangement_status"::text <> 'unavailable' or coalesce("equipment_requests"."unavailable_reason", '') ~ '[^[:space:]]');