-- PTR-133: move the venue no-overlap guarantee to the `venue_occupancy` ledger (ADR-7). Drizzle
-- Kit cannot create an EXCLUDE constraint, so this file is the reviewed `db:generate --custom`
-- exception. Do not edit generated DDL.
--
-- 1. The constraint. `make_interval` and `tsrange` are IMMUTABLE, so the buffers can be part of the
--    index expression. `[)` lets two periods touch without a conflict. Migration 0019 installed
--    `btree_gist`, which gives the GiST equality operator for `venue_id`.
ALTER TABLE "venue_occupancy" ADD CONSTRAINT "venue_occupancy_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, tsrange("starts_at" - make_interval(mins => "setup_minutes"), "ends_at" + make_interval(mins => "turnaround_minutes"), '[)') WITH &&) WHERE ("active");--> statement-breakpoint
-- 2. The ledger replaces the per-table constraints from 0019 and 0024.
ALTER TABLE "venue_requests" DROP CONSTRAINT "venue_requests_no_overlap";--> statement-breakpoint
ALTER TABLE "venue_holds" DROP CONSTRAINT "venue_holds_no_overlap";--> statement-breakpoint
-- 3. No constraint, index or query calls the status wrappers now. 0047 moved the approved-booking
--    index to a direct status comparison.
DROP FUNCTION "public"."venue_hold_occupies_venue"("public"."venue_hold_status");--> statement-breakpoint
DROP FUNCTION "public"."venue_request_occupies_venue"("public"."venue_request_status");
