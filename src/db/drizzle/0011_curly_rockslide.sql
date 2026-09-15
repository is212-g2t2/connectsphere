CREATE TABLE "equipment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"assigned_staff_id" text,
	"item" text NOT NULL,
	"arrangement_status" text DEFAULT 'requested' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "event_coordinators" (
	"event_id" text NOT NULL,
	"coordinator_id" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_coordinators_event_id_coordinator_id_pk" PRIMARY KEY("event_id","coordinator_id")
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"event_id" text NOT NULL,
	"attendee_id" text NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_event_id_attendee_id_pk" PRIMARY KEY("event_id","attendee_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"venue" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"registration_enabled" boolean DEFAULT false NOT NULL,
	"registration_opens_at" timestamp,
	"registration_closes_at" timestamp,
	"expected_attendance" integer,
	"layout" text,
	"accessibility_requirements" text,
	"required_facilities" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"assigned_staff_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_assigned_staff_id_user_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_coordinators" ADD CONSTRAINT "event_coordinators_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_coordinators" ADD CONSTRAINT "event_coordinators_coordinator_id_user_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_attendee_id_user_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_assigned_staff_id_user_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;