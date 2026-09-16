CREATE TYPE "public"."equipment_arrangement_status" AS ENUM('requested', 'reserved');--> statement-breakpoint
CREATE TYPE "public"."event_registration_status" AS ENUM('registered');--> statement-breakpoint
CREATE TYPE "public"."venue_request_status" AS ENUM('pending');--> statement-breakpoint
CREATE TABLE "equipment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"assigned_staff_id" text,
	"item" text NOT NULL,
	"arrangement_status" "equipment_arrangement_status" DEFAULT 'requested' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"event_id" integer NOT NULL,
	"attendee_id" text NOT NULL,
	"status" "event_registration_status" DEFAULT 'registered' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registrations_event_id_attendee_id_pk" PRIMARY KEY("event_id","attendee_id")
);
--> statement-breakpoint
CREATE TABLE "venue_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"assigned_staff_id" text,
	"status" "venue_request_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_event_id_event_requests_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_assigned_staff_id_user_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_event_requests_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_attendee_id_user_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_event_id_event_requests_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_assigned_staff_id_user_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_requests_event_id_idx" ON "equipment_requests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "equipment_requests_assigned_staff_id_idx" ON "equipment_requests" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE INDEX "event_registrations_attendee_id_idx" ON "event_registrations" USING btree ("attendee_id");--> statement-breakpoint
CREATE INDEX "venue_requests_event_id_idx" ON "venue_requests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "venue_requests_assigned_staff_id_idx" ON "venue_requests" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE INDEX "event_requests_organiser_id_idx" ON "event_requests" USING btree ("organiser_id");--> statement-breakpoint
CREATE INDEX "event_requests_assigned_coordinator_id_idx" ON "event_requests" USING btree ("assigned_coordinator_id");