ALTER TYPE "public"."venue_request_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "venue_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "starts_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "ends_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "requested_by_id" text;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_requests_pending_event_venue_idx" ON "venue_requests" USING btree ("event_id","venue_id") WHERE "venue_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_ends_after_starts" CHECK ("venue_requests"."ends_at" > "venue_requests"."starts_at");