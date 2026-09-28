CREATE TYPE "public"."venue_hold_status" AS ENUM('held', 'released');--> statement-breakpoint
CREATE TABLE "venue_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"venue_id" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" "venue_hold_status" DEFAULT 'held' NOT NULL,
	"held_by_id" text,
	"released_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_holds_ends_after_starts" CHECK ("venue_holds"."ends_at" > "venue_holds"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_event_id_event_requests_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_held_by_id_user_id_fk" FOREIGN KEY ("held_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_released_by_id_user_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_holds_event_id_idx" ON "venue_holds" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "venue_holds_venue_id_starts_at_idx" ON "venue_holds" USING btree ("venue_id","starts_at");--> statement-breakpoint
CREATE INDEX "venue_holds_held_by_id_idx" ON "venue_holds" USING btree ("held_by_id");--> statement-breakpoint
CREATE INDEX "venue_holds_released_by_id_idx" ON "venue_holds" USING btree ("released_by_id");--> statement-breakpoint
-- PTR-109: no two active tentative holds may overlap for one venue. Drizzle Kit cannot express an
-- EXCLUDE constraint, so this migration is hand-written by design per ADR-5. The predicate must be
-- IMMUTABLE, which rules out `status::text = 'held'` (enum_out is STABLE), hence the wrapper
-- function. `tsrange(..., '[)')` enforces strict no-buffer semantics: touching periods are free.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE FUNCTION "public"."venue_hold_occupies_venue"("public"."venue_hold_status")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS 'SELECT $1::text = ''held''';--> statement-breakpoint
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, tsrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("public"."venue_hold_occupies_venue"("status"));