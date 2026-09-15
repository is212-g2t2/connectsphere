CREATE TABLE "event_assignment_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"recipient_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_request_id" integer NOT NULL,
	"from_coordinator_id" text,
	"to_coordinator_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_assignment_notifications" ADD CONSTRAINT "event_assignment_notifications_assignment_id_event_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."event_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_assignment_notifications" ADD CONSTRAINT "event_assignment_notifications_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_assignments" ADD CONSTRAINT "event_assignments_event_request_id_event_requests_id_fk" FOREIGN KEY ("event_request_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_assignment_notifications_recipient_idx" ON "event_assignment_notifications" USING btree ("assignment_id","recipient_id");