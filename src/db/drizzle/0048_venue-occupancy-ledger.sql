-- PTR-133: move the venue no-overlap guarantee to the `venue_occupancy` ledger (ADR-7). Drizzle
-- Kit cannot create an EXCLUDE constraint, so this file is the reviewed `db:generate --custom`
-- exception. Do not edit generated DDL.
--
-- 1. Backfill. Each approved booking gets a row with its venue's buffers at migration time. Each
--    held hold gets a row with the buffers that it stored when it was placed.
INSERT INTO "venue_occupancy" ("venue_id", "event_id", "venue_request_id", "starts_at", "ends_at", "setup_minutes", "turnaround_minutes")
SELECT "venue_requests"."venue_id", "venue_requests"."event_id", "venue_requests"."id", "venue_requests"."starts_at", "venue_requests"."ends_at", "venues"."setup_minutes", "venues"."turnaround_minutes"
FROM "venue_requests"
INNER JOIN "venues" ON "venues"."id" = "venue_requests"."venue_id"
WHERE "venue_requests"."status" = 'approved';--> statement-breakpoint
INSERT INTO "venue_occupancy" ("venue_id", "event_id", "venue_hold_id", "starts_at", "ends_at", "setup_minutes", "turnaround_minutes")
SELECT "venue_id", "event_id", "id", "starts_at", "ends_at", "setup_minutes", "turnaround_minutes"
FROM "venue_holds"
WHERE "status" = 'held';--> statement-breakpoint
-- 2. Pre-flight report. The old constraints apply per table, so a booking and a hold can overlap.
--    Buffers can also make adjacent commitments overlap. List every pair that the constraint would
--    refuse, and stop. The migrate transaction then rolls back, and nothing in it applies. Venue
--    Staff release or amend one side of each pair, then the deploy runs again.
DO $$
DECLARE
  dirty_pairs text;
BEGIN
  SELECT string_agg(
    format(
      '%s: %s %s for "%s", %s to %s (setup %s, turnaround %s minutes) overlaps %s %s for "%s", %s to %s (setup %s, turnaround %s minutes)',
      "venues"."name",
      CASE WHEN "a"."venue_request_id" IS NOT NULL THEN 'booking' ELSE 'hold' END,
      coalesce("a"."venue_request_id", "a"."venue_hold_id"),
      "event_a"."event_name", "a"."starts_at", "a"."ends_at", "a"."setup_minutes", "a"."turnaround_minutes",
      CASE WHEN "b"."venue_request_id" IS NOT NULL THEN 'booking' ELSE 'hold' END,
      coalesce("b"."venue_request_id", "b"."venue_hold_id"),
      "event_b"."event_name", "b"."starts_at", "b"."ends_at", "b"."setup_minutes", "b"."turnaround_minutes"
    ),
    E'\n' ORDER BY "venues"."name", "a"."starts_at", "b"."starts_at"
  )
  INTO dirty_pairs
  FROM "venue_occupancy" "a"
  INNER JOIN "venue_occupancy" "b"
    ON "b"."venue_id" = "a"."venue_id"
    AND "b"."id" > "a"."id"
    AND tsrange("a"."starts_at" - make_interval(mins => "a"."setup_minutes"), "a"."ends_at" + make_interval(mins => "a"."turnaround_minutes"), '[)')
      && tsrange("b"."starts_at" - make_interval(mins => "b"."setup_minutes"), "b"."ends_at" + make_interval(mins => "b"."turnaround_minutes"), '[)')
  INNER JOIN "venues" ON "venues"."id" = "a"."venue_id"
  INNER JOIN "event_requests" "event_a" ON "event_a"."id" = "a"."event_id"
  INNER JOIN "event_requests" "event_b" ON "event_b"."id" = "b"."event_id";
  IF dirty_pairs IS NOT NULL THEN
    RAISE EXCEPTION E'venue_occupancy_no_overlap pre-flight: these commitments overlap once setup and turnaround count. Release or amend one side of each pair, then migrate again.\n%', dirty_pairs;
  END IF;
END $$;--> statement-breakpoint
-- 3. The constraint. `make_interval` and `tsrange` are IMMUTABLE, so the buffers can be part of the
--    index expression. `[)` lets two periods touch without a conflict. Migration 0019 installed
--    `btree_gist`, which gives the GiST equality operator for `venue_id`.
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, tsrange("starts_at" - make_interval(mins => "setup_minutes"), "ends_at" + make_interval(mins => "turnaround_minutes"), '[)') WITH &&) WHERE ("active");--> statement-breakpoint
-- 4. The ledger replaces the per-table constraints from 0019 and 0024.
ALTER TABLE "venue_requests" DROP CONSTRAINT "venue_requests_no_overlap";--> statement-breakpoint
ALTER TABLE "venue_holds" DROP CONSTRAINT "venue_holds_no_overlap";--> statement-breakpoint
-- 5. No constraint, index or query calls the status wrappers now. 0047 moved the approved-booking
--    index to a direct status comparison.
DROP FUNCTION "public"."venue_hold_occupies_venue"("public"."venue_hold_status");--> statement-breakpoint
DROP FUNCTION "public"."venue_request_occupies_venue"("public"."venue_request_status");
