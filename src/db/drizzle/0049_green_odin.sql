DROP INDEX "venue_requests_pending_event_venue_idx";--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "expected_attendance" integer;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "layout" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "accessibility_requirements" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "required_facilities" text;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_requests_pending_event_venue_window_idx" ON "venue_requests" USING btree ("event_id","venue_id","starts_at","ends_at") WHERE "venue_requests"."status" = 'pending';