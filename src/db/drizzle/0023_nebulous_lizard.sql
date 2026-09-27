ALTER TYPE "public"."venue_request_status" ADD VALUE 'released';--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "last_changed_by_staff_id" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "last_changed_by_staff_name" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "last_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_last_changed_by_staff_id_user_id_fk" FOREIGN KEY ("last_changed_by_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_requests_approved_starts_at_idx" ON "venue_requests" USING btree ("starts_at") WHERE venue_request_occupies_venue("venue_requests"."status");--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_release_has_reason" CHECK ("venue_requests"."status"::text <> 'released' or coalesce("venue_requests"."release_reason", '') ~ '[^[:space:]]');