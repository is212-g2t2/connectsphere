CREATE TABLE "event_information_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"field" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"changed_by_id" text NOT NULL,
	"changed_by_name" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_information_changes" ADD CONSTRAINT "event_information_changes_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_information_changes_event_request_id_idx" ON "event_information_changes" USING btree ("event_request_id");