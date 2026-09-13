CREATE TYPE "public"."event_request_status" AS ENUM('draft');--> statement-breakpoint
CREATE TABLE "event_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organiser_id" text NOT NULL,
	"status" "event_request_status" DEFAULT 'draft' NOT NULL,
	"event_name" text DEFAULT '' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"proposed_start" timestamp,
	"proposed_end" timestamp,
	"expected_attendance" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_organiser_id_user_id_fk" FOREIGN KEY ("organiser_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;