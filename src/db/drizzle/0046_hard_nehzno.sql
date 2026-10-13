CREATE TABLE "venue_buffer_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue_id" integer NOT NULL,
	"previous_setup_minutes" integer NOT NULL,
	"previous_turnaround_minutes" integer NOT NULL,
	"setup_minutes" integer NOT NULL,
	"turnaround_minutes" integer NOT NULL,
	"changed_by_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "setup_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD COLUMN "turnaround_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "setup_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "turnaround_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_buffer_changes" ADD CONSTRAINT "venue_buffer_changes_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_buffer_changes_venue_id_idx" ON "venue_buffer_changes" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "venue_holds_venue_id_occupied_start_idx" ON "venue_holds" USING btree ("venue_id",("starts_at" - make_interval(mins => "setup_minutes")));--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_setup_minutes_nonnegative" CHECK ("venue_holds"."setup_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_turnaround_minutes_nonnegative" CHECK ("venue_holds"."turnaround_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_setup_minutes_nonnegative" CHECK ("venues"."setup_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_turnaround_minutes_nonnegative" CHECK ("venues"."turnaround_minutes" >= 0);