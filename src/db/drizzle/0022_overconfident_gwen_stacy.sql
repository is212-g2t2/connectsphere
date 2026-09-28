CREATE TYPE "public"."event_handover_decision" AS ENUM('accepted', 'declined');--> statement-breakpoint
CREATE TABLE "event_handovers" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"from_coordinator_id" text NOT NULL,
	"to_coordinator_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "event_handover_decision",
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "event_handovers_decision_complete" CHECK (("event_handovers"."decision" is null and "event_handovers"."decided_by_id" is null and "event_handovers"."decided_at" is null) or ("event_handovers"."decision" is not null and "event_handovers"."decided_by_id" is not null and "event_handovers"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "event_handovers" ADD CONSTRAINT "event_handovers_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_handovers_pending_event_idx" ON "event_handovers" USING btree ("event_request_id") WHERE "event_handovers"."decision" is null;--> statement-breakpoint
CREATE INDEX "event_handovers_to_coordinator_id_idx" ON "event_handovers" USING btree ("to_coordinator_id");