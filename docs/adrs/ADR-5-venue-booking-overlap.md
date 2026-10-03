---
date: 2026-09-23
adr-number: ADR-5
status: accepted
---

# ADR-5: Overlap-free approved bookings, enforced by a PostgreSQL exclusion constraint

## Context

Two Venue Staff members can approve overlapping requests for one venue within the same second. An application-level "is it free?" check reads a snapshot and then writes, so both approvals can pass it. Only the database can refuse the second write when it arrives.

Drizzle Kit cannot express an `EXCLUDE` constraint, and the Drizzle migrator runs all pending migrations in one transaction. Those facts rule out the obvious spellings of an `approved`-only predicate. `status = 'approved'` fails with "unsafe use of new value", because the `approved` enum label is added in the same transaction. `status::text = 'approved'` fails because `enum_out` is STABLE and a partial-index predicate must be IMMUTABLE. Migration 0017's `status::text` trick works only because it sits in a CHECK constraint, and a CHECK constraint does not enforce immutability.

## Decision

Enforce the invariant in PostgreSQL. `0019_booking-overlap-constraint` is a `drizzle-kit generate --custom` file, so the generated DDL stays untouched. It creates:

- `CREATE EXTENSION IF NOT EXISTS btree_gist`, which supplies the GiST equality operator class for `venue_id`.
- An `IMMUTABLE` wrapper `venue_request_occupies_venue(venue_request_status)` whose body compares `$1::text = 'approved'`.
- `EXCLUDE USING gist (venue_id WITH =, tsrange(starts_at, ends_at, '[)') WITH &&) WHERE (venue_request_occupies_venue(status))`.

The predicate is partial, so pending requests can stack, as PTR-36 criterion 4 requires. `approved` is the only holding status today. `[)` makes overlap strict: periods that only touch at a boundary do not conflict. That is the no-buffer semantics that the story asks for, and it permits a free handover.

`handleApproveVenueRequest` also serializes approvals per venue with `pg_advisory_xact_lock(venue_id)`. Concurrent exclusion-constraint writers can deadlock (PostgreSQL documents the race). Without the lock, the loser surfaces as a fault. With the lock, the loser reads the committed booking and is refused as conflicting. The 23P01 violation is still mapped to the same `ConflictError` as a backstop. The refusal names the venue and the conflicting period, never the other event's name.

## Alternatives Considered

### An application-level overlap check

- Pros: no hand-written DDL, no extension, no wrapper function.
- Cons: a read-then-write race. Two approvals can both pass the check, and the second write wins.
- Rejected: it cannot satisfy "exactly one is recorded" under concurrency.

### Predicate over committed labels (`status <> 'pending' AND status <> 'withdrawn'`)

- Pros: no wrapper function, and the predicate is valid today.
- Cons: every future enum value joins the constraint silently, so a later `rejected` or `released` status wrongly holds the venue.
- Rejected: the failure mode is over-blocking that no test catches until a release path hits it.

### Recreate the enum type inside the migration

- Pros: a clean `status = 'approved'` predicate.
- Cons: a table rewrite, and the team must drop and recreate the dependent partial unique index and CHECK constraint by hand.
- Rejected: far more hand-written DDL than a six-line function.

### Enforce with a trigger

- Pros: expressive, no extension.
- Cons: race-prone without locking, and slower than an index check.
- Rejected: reimplements what the exclusion constraint already does correctly.

## Consequences

- `db:push` and `db:pull` do not know about the constraint. Never regenerate the baseline from an introspected database, and never run `db:push` against a database that has 0019.
- The constraint is absent from the Drizzle snapshot by design. `db:generate` therefore never drops it, and the continuous integration (CI) `db:generate && git diff` check stays clean.
- `btree_gist` is a trusted extension that a database owner can install, but the deploy pre-flight must confirm it on Supabase. The migration's `IF NOT EXISTS` keeps re-runs safe.
- `venue_requests_no_overlap` re-checks an amendment of an approved booking's period (PTR-37) against other approved bookings. A move out of `approved` frees the slot. No single constraint spans `venue_holds` and `venue_requests`. Cross-table mutual exclusion therefore runs on the shared `pg_advisory_xact_lock(venue_id)` convention, which writers take before any row lock or write. An amendment must take that lock too.
- PTR-109 adds tentative venue holds in `venue_holds`. PostgreSQL exclusion constraints cannot span tables, so intra-table hold overlap uses a dedicated exclusion constraint. That constraint is `venue_holds_no_overlap` (`0024_venue-hold-overlap-constraint`), with the immutable wrapper `venue_hold_occupies_venue(venue_hold_status)`. Cross-table mutual exclusion between active holds and approved bookings rests on the shared `pg_advisory_xact_lock(venue_id)`. Hold creation, release, and conversion take that lock first, before their row lock and write. Booking approval takes it before its conflict check and write. The intra-table exclusion constraints are the backstop for a writer that does not come through those handlers.
- `handleConfirmEvent` locks the event's `venue_requests` rows while it gates, without `pg_advisory_xact_lock(venue_id)`. It writes no `venue_requests` or `venue_holds` row, so it sits outside the occupancy-writer class. A change that starts to write either table inside the confirmation transaction must take that lock before the write.
- The Drizzle migrator stores each migration's hash, but it decides what to run from the timestamp alone. The migrator therefore never re-runs an edit of an already-applied migration. A database that applied 0018 without 0019 still receives 0019 normally. A change to 0019 after it was applied needs a manual constraint update.
