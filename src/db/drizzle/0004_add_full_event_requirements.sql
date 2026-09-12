ALTER TABLE "event_requests" ADD COLUMN "proposed_dates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "event_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "venue_requirements" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "room_layout_preference" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "accessibility_requirements" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "equipment_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "special_arrangements" text DEFAULT '' NOT NULL;