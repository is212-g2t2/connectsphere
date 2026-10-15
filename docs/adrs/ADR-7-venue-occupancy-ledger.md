---
date: 2026-10-13
adr-number: ADR-7
status: accepted
---

# ADR-7: One venue occupancy ledger, guarded by a buffered exclusion constraint

> **Amended 2026-10-15:** venue blocks now suspend and restore ledger rows (PTR-136, [ADR-8](./ADR-8-venue-block-suspension.md)). A block row can have a null end, and the block writers set `active` in place. ADR-8 also sets the order in which a refusal names a conflict. The ledger and its constraint stand.

## Context

[ADR-5](./ADR-5-venue-booking-overlap.md) kept venue time free of overlaps with two exclusion constraints on the requested times: `venue_requests_no_overlap` for approved bookings and `venue_holds_no_overlap` for held holds. Three rules break that shape:

- A venue's setup and turnaround time must count in every conflict, for bookings and for holds.
- A venue block must refuse bookings and holds, also when the block comes after the booking.
- A booking and a hold must exclude each other. An exclusion constraint cannot span two tables, so only the advisory lock kept them apart.

An index expression cannot read `venues`, so each row must store the buffers that it uses.

## Decision

Keep every active commitment in one table, `venue_occupancy`, and guard it with one constraint.

| Part       | Rule                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows       | One row per approved booking, held hold or active block. A row has one source (`venue_request_id`, `venue_hold_id` or `venue_unavailability_id`), the venue, the event (none for a block), the requested period, `setup_minutes`, `turnaround_minutes` and `active`. Only a block row can have a null end.                                                |
| Constraint | `venue_occupancy_no_overlap`: `EXCLUDE USING gist (venue_id WITH =, tsrange(starts_at - make_interval(mins => setup_minutes), ends_at + make_interval(mins => turnaround_minutes), '[)') WITH &&) WHERE (active)`.                                                                                                                                        |
| Writers    | The advisory-locked server functions write the rows in the transaction that changes the source. Approval and hold creation insert. Release, hold release and hold conversion delete. Amendment deletes, then inserts. Only the block writers edit a row in place: they set `active` ([ADR-8](./ADR-8-venue-block-suspension.md)). No trigger writes rows. |
| Refusals   | Under the venue lock, a writer reads the ledger and names the venue and the occupied period of the conflict, in the order that [ADR-8](./ADR-8-venue-block-suspension.md) sets. The constraint is the authority. The ledger insert maps 23P01 and 40P01 to `VENUE_OCCUPANCY_CONFLICT_MESSAGE`.                                                            |
| Buffers    | A booking row stores its venue's buffers at approval or amendment. A hold row stores the buffers that the hold stored when it was placed. A later venue edit does not change a stored row.                                                                                                                                                                |

`make_interval` and `tsrange` are IMMUTABLE, so the buffers can be part of the index expression. Buffers count on both sides. After 10:00–12:00 at a venue with 30 minutes setup and 45 minutes turnaround, the next booking can start at 13:15. `[)` lets two occupied periods touch.

Two concurrent inserts of overlapping rows can deadlock in the exclusion check. A 40P01 from the ledger insert is therefore a conflict too. Every app writer holds the venue lock first, so only a writer outside that rule meets either error.

### Snapshot policy

A venue buffer change does not rewrite stored rows, so the constraint does not guard the added buffer time of an existing commitment. PTR-132 adds a report that lists these commitments. Venue Staff amend or release a listed booking, and the Coordinator releases a listed hold. An amendment or a new approval writes a row with the current buffers.

### Suspension

[ADR-8](./ADR-8-venue-block-suspension.md) sets how a block suspends and restores ledger rows, the open end of a block, the audit columns and the lock order of the block writers.

### Migration exemption

Drizzle Kit cannot express an EXCLUDE constraint. `0048_venue-occupancy-ledger` is the reviewed `db:generate --custom` exception. It adds `venue_occupancy_no_overlap`, then drops `venue_requests_no_overlap`, `venue_holds_no_overlap` and their status wrappers `venue_request_occupies_venue` and `venue_hold_occupies_venue`.

The custom files `0019` and `0024` stay in the journal as history. The 0047 predicate of `venue_requests_approved_starts_at_idx` compares an enum label directly (`status = 'approved'`). A deployed database committed that label long ago. A fresh database creates the enum type in the same transaction, and PostgreSQL then allows its labels.

## Alternatives Considered

### Keep one constraint per table, with buffer columns on each

- Pros: no new table.
- Cons: no constraint spans bookings, holds and blocks. A block cannot refuse a booking.
- Rejected: the cross-table guarantee stays on the advisory lock alone.

### Write ledger rows with triggers

- Pros: a writer cannot forget the ledger.
- Cons: triggers fire outside the writers' lock order, and they bring ordering, foreign key and rollback hazards.
- Rejected: the writers already hold the venue lock and one transaction.

### An application-level overlap check

- Rejected for the reason in ADR-5: two writers can both pass a read-then-write check.

### A constraint on the source tables that reads the venue's buffers

- Rejected: an index expression cannot read another table.

## Consequences

- As in ADR-5, the Drizzle snapshot, `db:push` and `db:pull` do not know the constraint. Never run `db:push` against a database that has 0048. `btree_gist` from 0019 stays required.
- The lock order of ADR-5 stays: the event key-share lock, then the venue advisory locks in ascending venue order, then the row locks. `handleConfirmEvent` writes no venue or occupancy row, so it takes no venue lock. The block writers take the venue lock first ([ADR-8](./ADR-8-venue-block-suspension.md)).
- 0048 copies no existing booking or hold into the ledger, because no deployed database held live data when it shipped. A booking or hold from before 0048 blocks no other write until an amendment, or a release and a new hold, writes its row.
- Only the server functions and the seed write ledger rows. A hand-written change to a booking or a hold must change its `venue_occupancy` row in the same transaction.
- The seed takes the venue lock for its block writes and no venue lock for its booking writes. The constraint guards both.
- Availability, search, the request queue and the conflict flags still read the source tables until PTR-135 moves them to the ledger. Until then, they show bookings without buffers. A request in the buffer of a booking therefore shows no conflict flag, and approval then refuses it.
