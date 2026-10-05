CREATE TYPE "public"."vip_registration_change" AS ENUM('added', 'removed');--> statement-breakpoint
CREATE TABLE "vip_registration_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"attendee_id" text NOT NULL,
	"change" "vip_registration_change" NOT NULL,
	"actor_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "vip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vip_registration_changes" ADD CONSTRAINT "vip_registration_changes_event_id_event_requests_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vip_registration_changes_event_id_idx" ON "vip_registration_changes" USING btree ("event_id");