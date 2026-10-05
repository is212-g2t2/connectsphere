CREATE TYPE "public"."event_cancellation_outcome" AS ENUM('cancelled', 'declined');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'event_cancellation_requested';--> statement-breakpoint
CREATE TABLE "event_cancellation_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"organiser_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "event_cancellation_outcome",
	"decline_reason" text,
	"processed_by_id" text,
	"processed_by_name" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "event_cancellation_requests_outcome_complete" CHECK (("event_cancellation_requests"."outcome" is null and "event_cancellation_requests"."processed_by_id" is null and "event_cancellation_requests"."processed_by_name" is null and "event_cancellation_requests"."processed_at" is null and "event_cancellation_requests"."decline_reason" is null) or ("event_cancellation_requests"."outcome" is not null and "event_cancellation_requests"."processed_by_id" is not null and "event_cancellation_requests"."processed_by_name" is not null and "event_cancellation_requests"."processed_at" is not null)),
	CONSTRAINT "event_cancellation_requests_decline_has_reason" CHECK (("event_cancellation_requests"."outcome"::text = 'declined' and coalesce("event_cancellation_requests"."decline_reason", '') ~ '[^[:space:]]') or ("event_cancellation_requests"."outcome" is distinct from 'declined' and "event_cancellation_requests"."decline_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_organiser_id_user_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_cancellation_requests_event_request_id_idx" ON "event_cancellation_requests" USING btree ("event_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_cancellation_requests_open_event_idx" ON "event_cancellation_requests" USING btree ("event_request_id") WHERE "event_cancellation_requests"."outcome" is null;