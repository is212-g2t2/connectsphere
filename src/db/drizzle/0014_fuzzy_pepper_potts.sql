ALTER TYPE "public"."event_request_status" ADD VALUE 'awaiting_organiser';--> statement-breakpoint
CREATE TABLE "clarification_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"coordinator_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clarification_requests" ADD CONSTRAINT "clarification_requests_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clarification_requests_event_request_id_idx" ON "clarification_requests" USING btree ("event_request_id");