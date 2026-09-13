CREATE TABLE "venue_unavailability" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue_id" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_unavailability_ends_after_starts" CHECK ("venue_unavailability"."ends_at" > "venue_unavailability"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"max_capacity" integer NOT NULL,
	"facilities" text[] DEFAULT '{}' NOT NULL,
	"accessibility_features" text[] DEFAULT '{}' NOT NULL,
	"supported_layouts" text[] DEFAULT '{}' NOT NULL,
	"operating_hours" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_name_unique" UNIQUE("name"),
	CONSTRAINT "venues_max_capacity_positive" CHECK ("venues"."max_capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "venue_unavailability" ADD CONSTRAINT "venue_unavailability_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_unavailability_period_idx" ON "venue_unavailability" USING btree ("venue_id","starts_at","ends_at");