ALTER TABLE "event_registrations" ADD COLUMN "vip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "added_by_id" text;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "removed_by_id" text;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_vip_has_actor" CHECK ("event_registrations"."vip" = ("event_registrations"."added_by_id" is not null));--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_removal_complete" CHECK (("event_registrations"."removed_by_id" is null and "event_registrations"."removed_at" is null) or ("event_registrations"."removed_by_id" is not null and "event_registrations"."removed_at" is not null and "event_registrations"."vip" and "event_registrations"."status"::text = 'withdrawn'));