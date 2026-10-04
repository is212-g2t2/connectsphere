CREATE TYPE "public"."notification_kind" AS ENUM('venue_booking_requested', 'venue_booking_approved', 'venue_booking_rejected', 'venue_booking_changed', 'clarification_requested', 'clarification_replied', 'handover_requested', 'handover_accepted', 'handover_declined', 'event_decided', 'event_confirmed', 'equipment_requested', 'equipment_arrangements_completed', 'equipment_unavailable', 'equipment_released');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"event_request_id" integer NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_email_error" text
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_at_idx" ON "notifications" USING btree ("recipient_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."emailed_at" is null and "notifications"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_event_request_id_idx" ON "notifications" USING btree ("event_request_id");