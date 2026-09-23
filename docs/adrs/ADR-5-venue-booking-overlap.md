---
date: 2026-09-23
adr-number: ADR-5
status: accepted
---

# ADR-5: Overlap-free approved bookings, enforced by a Postgres exclusion constraint

## Context

Two Venue Staff members can approve overlapping requests for one venue within the same second. An application-level "is it free?" check reads a snapshot and then writes, so both approvals can pass it; only the database can refuse the second write as it lands.

Drizzle Kit cannot express an `EXCLUDE` constraint, and Drizzle's migrator runs all pending migrations in one transaction. That rules out the obvious spellings of an `approved`-only predicate: `status = 'approved'` fails with "unsafe use of new value" because the `approved` enum label is added in the same transaction, and `status::text = 'approved'` fails because `enum_out` is STABLE and a partial-index predicate must be IMMUTABLE. Migration 0017's `status::text` trick works only because it sits in a CHECK constraint, which does not enforce immutability.

## Decision

Enforce the invariant in Postgres. `0019_booking-overlap-constraint` (a `drizzle-kit generate --custom` file, so generated DDL stays untouched) creates:

- `CREATE EXTENSION IF NOT EXISTS btree_gist`, which supplies the GiST equality operator class for `venue_id`.
- An `IMMUTABLE` wrapper `venue_request_occupies_venue(venue_request_status)` whose body compares `$1::text = 'approved'`.
- `EXCLUDE USING gist (venue_id WITH =, tsrange(starts_at, ends_at, '[)') WITH &&) WHERE (venue_request_occupies_venue(status))`.

The predicate is partial so pending requests stack, as PTR-36 criterion 4 requires; `approved` is the only holding status today. `[)` makes overlap strict: periods that only touch at a boundary do not conflict, which is the no-buffer semantics the story asks for and a free handover.

`handleApproveVenueRequest` also serialises approvals per venue with `pg_advisory_xact_lock(venue_id)`. Concurrent exclusion-constraint writers can deadlock (Postgres documents the race), so without the lock the loser would surface as a fault; with it, the loser reads the committed booking and is refused as conflicting. The 23P01 violation is still mapped to the same `ConflictError` as a backstop, and the refusal names the venue and conflicting period, never the other event's name.

## Alternatives Considered

### An application-level overlap check

- Pros: no hand-written DDL, no extension, no wrapper function.
- Cons: a read-then-write race — two approvals can both pass the check, and the second write wins.
- Rejected: it cannot satisfy "exactly one is recorded" under concurrency.

### Predicate over committed labels (`status <> 'pending' AND status <> 'withdrawn'`)

- Pros: no wrapper function; valid today.
- Cons: every future enum value silently joins the constraint, so a later `rejected` or `released` status would wrongly hold the venue.
- Rejected: the failure mode is over-blocking that no test catches until a release path hits it.

### Recreate the enum type inside the migration

- Pros: a clean `status = 'approved'` predicate.
- Cons: a table rewrite plus dropping and recreating the dependent partial unique index and CHECK constraint, all hand-written.
- Rejected: far more hand-written DDL than a six-line function.

### Enforce with a trigger

- Pros: expressive, no extension.
- Cons: race-prone without locking, and slower than an index check.
- Rejected: reimplements what the exclusion constraint already does correctly.

## Consequences

- `db:push` and `db:pull` do not know about the constraint: never regenerate the baseline from an introspected database, and never run `db:push` against a database that has 0019.
- The constraint is absent from the Drizzle snapshot by design, so `db:generate` never drops it and CI's `db:generate && git diff` check stays clean.
- `btree_gist` is a trusted extension (installable by a database owner), but the deploy pre-flight must confirm it on Supabase; the migration's `IF NOT EXISTS` keeps re-runs safe.
- Amending an approved booking's period is re-checked by the constraint automatically, and moving it out of `approved` frees the slot; PTR-37 reuses the same refusal mapping.
- PTR-109's tentative holds extend `venue_request_occupies_venue` (or add a second constraint); whether holds may overlap each other is a decision for that story.
- Drizzle's migrator records only a migration's timestamp, not its SQL hash, so editing an already-applied migration never re-runs it: a database that applied 0018 without 0019 still receives 0019 normally, but a change made to 0019 after it was applied needs a manual constraint update.
