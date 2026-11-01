-- PTR-152: require an expiry on every placed (`held`) hold. The request-and-place gate
-- (PTR-150 and PTR-151) already forces each new `held` row through placement with an expiry,
-- so no current writer leaves `expires_at` null. Drizzle Kit generates no data fix, so this
-- file is the reviewed `db:generate --custom` exception, as migration 0048 is (ADR-7). The
-- check lives outside the Drizzle snapshot, so `db:generate` never drops it. Do not edit the
-- constraint without updating `venueHolds`' comment in `src/db/schema.ts`.
--
-- 1. Resolve the rows that predate the gate. Flip a null-expiry `held` hold to `expired` and
--    free its ledger row, as the PTR-143 sweep does for a lapsed hold. These rows raise no
--    notice; they predate expiry notices. On a fresh database both statements touch no rows.
DELETE FROM "venue_occupancy" WHERE "venue_hold_id" IN (SELECT "id" FROM "venue_holds" WHERE "status" = 'held' AND "expires_at" IS NULL);--> statement-breakpoint
UPDATE "venue_holds" SET "status" = 'expired' WHERE "status" = 'held' AND "expires_at" IS NULL;--> statement-breakpoint
-- 2. The constraint. Compare `status` as text, as the other `venue_holds` CHECKs do. Only
--    `held` needs an expiry; a `requested`, `declined`, `released` or `expired` row keeps
--    `expires_at` nullable.
ALTER TABLE "venue_holds" ADD CONSTRAINT "venue_holds_held_requires_expiry" CHECK (("venue_holds"."status"::text <> 'held' or "venue_holds"."expires_at" is not null));
