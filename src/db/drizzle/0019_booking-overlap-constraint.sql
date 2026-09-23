-- PTR-36: no two approved bookings may overlap for one venue. Drizzle Kit cannot express an
-- EXCLUDE constraint, so this migration is hand-written by design; the reviewed exemption is
-- ADR-5, and no generated DDL is touched. The predicate must be IMMUTABLE, which rules out both
-- `status::text = 'approved'` (enum_out is STABLE) and a direct comparison against the label
-- added in 0018 (Postgres refuses to use a same-transaction enum value), hence the wrapper
-- function. `tsrange(..., '[)')` is the strict no-buffer semantics: touching periods are free.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE FUNCTION "public"."venue_request_occupies_venue"("public"."venue_request_status")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS 'SELECT $1::text = ''approved''';--> statement-breakpoint
ALTER TABLE "venue_requests" ADD CONSTRAINT "venue_requests_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, tsrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("public"."venue_request_occupies_venue"("status"));
