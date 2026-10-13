CREATE TABLE "venue_occupancy" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue_id" integer NOT NULL,
	"event_id" integer,
	"venue_request_id" text,
	"venue_hold_id" text,
	"venue_unavailability_id" integer,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"setup_minutes" integer DEFAULT 0 NOT NULL,
	"turnaround_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "venue_occupancy_one_source" CHECK (num_nonnulls("venue_occupancy"."venue_request_id", "venue_occupancy"."venue_hold_id", "venue_occupancy"."venue_unavailability_id") = 1),
	CONSTRAINT "venue_occupancy_event_matches_source" CHECK (("venue_occupancy"."event_id" is null) = ("venue_occupancy"."venue_unavailability_id" is not null)),
	CONSTRAINT "venue_occupancy_ends_after_starts" CHECK ("venue_occupancy"."ends_at" > "venue_occupancy"."starts_at"),
	CONSTRAINT "venue_occupancy_setup_minutes_nonnegative" CHECK ("venue_occupancy"."setup_minutes" >= 0),
	CONSTRAINT "venue_occupancy_turnaround_minutes_nonnegative" CHECK ("venue_occupancy"."turnaround_minutes" >= 0)
);
--> statement-breakpoint
DROP INDEX "venue_requests_approved_starts_at_idx";--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_event_id_event_requests_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_venue_request_id_venue_requests_id_fk" FOREIGN KEY ("venue_request_id") REFERENCES "public"."venue_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_venue_hold_id_venue_holds_id_fk" FOREIGN KEY ("venue_hold_id") REFERENCES "public"."venue_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_venue_unavailability_id_venue_unavailability_id_fk" FOREIGN KEY ("venue_unavailability_id") REFERENCES "public"."venue_unavailability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_occupancy_venue_request_id_idx" ON "venue_occupancy" USING btree ("venue_request_id");--> statement-breakpoint
CREATE INDEX "venue_occupancy_venue_hold_id_idx" ON "venue_occupancy" USING btree ("venue_hold_id");--> statement-breakpoint
CREATE INDEX "venue_occupancy_venue_unavailability_id_idx" ON "venue_occupancy" USING btree ("venue_unavailability_id");--> statement-breakpoint
CREATE INDEX "venue_occupancy_event_id_idx" ON "venue_occupancy" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "venue_requests_approved_starts_at_idx" ON "venue_requests" USING btree ("starts_at") WHERE "venue_requests"."status" = 'approved';