ALTER TYPE "public"."notification_kind" ADD VALUE 'event_change_requested' BEFORE 'handover_requested';--> statement-breakpoint
CREATE TABLE "event_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"organiser_id" text NOT NULL,
	"what_should_change" text NOT NULL,
	"requested_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_change_requests_what_should_change_present" CHECK (btrim("event_change_requests"."what_should_change") <> '' and char_length("event_change_requests"."what_should_change") <= 2000),
	CONSTRAINT "event_change_requests_requested_value_present" CHECK (btrim("event_change_requests"."requested_value") <> '' and char_length("event_change_requests"."requested_value") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "event_change_requests" ADD CONSTRAINT "event_change_requests_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_change_requests" ADD CONSTRAINT "event_change_requests_organiser_id_user_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_change_requests_event_request_id_idx" ON "event_change_requests" USING btree ("event_request_id");