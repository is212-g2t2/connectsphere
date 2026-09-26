ALTER TYPE "public"."venue_request_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "suggested_venue_id" integer;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "suggested_date" date;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "suggested_start_time" time;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "suggested_end_time" time;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_suggested_venue_id_venues_id_fk" FOREIGN KEY ("suggested_venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_rejection_has_reason" CHECK ("venue_requests"."status"::text <> 'rejected' or btrim(coalesce("venue_requests"."rejection_reason", '')) <> '');