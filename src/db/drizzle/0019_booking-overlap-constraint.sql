-- PTR-36: prevent approved bookings for one venue from overlapping. Drizzle Kit cannot create an
-- EXCLUDE constraint, so this migration adds it by hand under the ADR-5 exception. Do not edit
-- generated DDL. The predicate must be IMMUTABLE. `status::text = 'approved'` calls STABLE
-- `enum_out` and is not allowed. A direct comparison with the label added in migration 0018 also
-- fails because PostgreSQL cannot use a new enum value in the same transaction. Use this wrapper
-- function instead. `tsrange(..., '[)')` allows periods to touch but prevents overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE FUNCTION "public"."venue_request_occupies_venue"("public"."venue_request_status")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS 'SELECT $1::text = ''approved''';--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, tsrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("public"."venue_request_occupies_venue"("status"));
