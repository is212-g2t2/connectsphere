ALTER TABLE "venue_requests" ADD COLUMN "replaces_request_id" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "dismissed_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_replaces_request_id_venue_requests_id_fk" FOREIGN KEY ("replaces_request_id") REFERENCES "public"."venue_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_dismissed_by_id_user_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_requests_replaces_request_id_idx" ON "venue_requests" USING btree ("replaces_request_id") WHERE "venue_requests"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "venue_requests_replaces_request_id_lookup_idx" ON "venue_requests" USING btree ("replaces_request_id");--> statement-breakpoint
CREATE INDEX "venue_requests_dismissed_by_id_idx" ON "venue_requests" USING btree ("dismissed_by_id");--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_dismissal_settled" CHECK ("venue_requests"."dismissed_at" is null or "venue_requests"."status"::text in ('rejected', 'released', 'withdrawn'));