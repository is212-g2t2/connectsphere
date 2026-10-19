---
date: 2026-10-13
adr-number: ADR-7
status: accepted
---

# ADR-7: One venue occupancy ledger, guarded by a buffered exclusion constraint

> **Amended 2026-10-15:** venue blocks now suspend and restore ledger rows (PTR-136). The Suspension and Refusal order sections record this change. The block alternatives and the block consequences also record it. The ledger and its constraint do not change.

> **Amended 2026-10-19:** holds gain two states that occupy no venue time, `requested` and `declined` (PTR-150). The Rows, Writers and Buffers rows and the Refusal order section record this change. The ledger and its constraint do not change.

## Context

[ADR-5](./ADR-5-venue-booking-overlap.md) kept venue time free of overlaps with two exclusion constraints on the requested times: `venue_requests_no_overlap` for approved bookings and `venue_holds_no_overlap` for held holds. Three rules break that shape:

- A venue's setup and turnaround time must count in every conflict, for bookings and for holds.
- A venue block must refuse bookings and holds, also when the block comes after the booking. The block must keep the bookings and holds that it covers. Venue Staff must be able to lift the block.
- A booking and a hold must exclude each other. An exclusion constraint cannot span two tables, so only the advisory lock kept them apart.

An index expression cannot read `venues`, so each row must store the buffers that it uses.

## Decision

Keep every active commitment in one table, `venue_occupancy`, and guard it with one constraint.

| Part       | Rule                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows       | One row per approved booking, held hold or active block. A `requested` or `declined` hold has no row. A row has one source (`venue_request_id`, `venue_hold_id` or `venue_unavailability_id`), the venue, the event (none for a block), the requested period, `setup_minutes`, `turnaround_minutes` and `active`. Only a block row can have a null end. |
| Constraint | `venue_occupancy_no_overlap`: `EXCLUDE USING gist (venue_id WITH =, tsrange(starts_at - make_interval(mins => setup_minutes), ends_at + make_interval(mins => turnaround_minutes), '[)') WITH &&) WHERE (active)`.                                                                                                                                      |
| Writers    | The advisory-locked server functions write the rows in the transaction that changes the source. Approval, hold creation and hold placement insert. Release, hold release and hold conversion delete. Amendment deletes, then inserts. Only the block writers edit a row in place: they set `active`. No trigger writes rows.                            |
| Refusals   | Under the venue lock, a writer reads the ledger and names the venue and the occupied period of the conflict, in the [refusal order](#refusal-order). The constraint is the authority. The ledger insert maps 23P01 and 40P01 to `VENUE_OCCUPANCY_CONFLICT_MESSAGE`.                                                                                     |
| Buffers    | A booking row stores its venue's buffers at approval or amendment. A hold row stores the buffers that the hold stored when it was placed. Placement of a hold request first refreshes the hold's buffers to the venue's current ones. A later venue edit does not change a stored row.                                                                  |

`make_interval` and `tsrange` are IMMUTABLE, so the buffers can be part of the index expression. Buffers count on both sides. After 10:00–12:00 at a venue with 30 minutes setup and 45 minutes turnaround, the next booking can start at 13:15. `[)` lets two occupied periods touch.

Two concurrent inserts of overlapping rows can deadlock in the exclusion check. A 40P01 from the ledger insert is therefore a conflict too. Every app writer holds the venue lock first, so only a writer outside that rule meets either error.

### Snapshot policy

A venue buffer save never rewrites stored ledger rows or blocks the change. Rewriting stored rows can violate the exclusion constraint mid-save, so existing rows keep their old buffers.

The venue page and calendar derive the flag from the current buffers, and the save notifies the assigned Coordinators. Users resolve flagged commitments manually: Venue Staff release or amend conflicting bookings, and Coordinators release conflicting holds or suspended bookings. Nothing is released automatically, and subsequent approvals or amendments insert fresh ledger rows with current buffers.

### Suspension

A block is one `venue_unavailability` row and one ledger row. The ledger row has no event and has buffers of 0. The block suspends the ledger rows that it covers. A lift restores these rows.

- **Period.** A null end means "until lifted". The constraint needs no change, because `tsrange(start, null, '[)')` has no upper bound. A block must start today or later, in venue local time.
- **Record.** The writer refuses a live block that overlaps the new period, because a block never suspends a block. A fully covered row becomes inactive and keeps its buffers. A partly covered row splits into pieces with absolute times and buffers of 0.
- **Pieces.** The covered piece is inactive. The pieces before and after the block stay active.
- **Lift.** The writer deletes the ledger row of the block. It restores each suspended row whose booking is approved or whose hold is held. It deletes the other suspended rows.
- **Rebuild.** When all the pieces of a source are active again, the writer replaces them with one row. This row has the start and end of the source. Its buffers reach to the start of the first piece and to the end of the last piece.
- **Audit.** Record writes `created_by_id` and `created_at`. Lift writes `lifted_at` and `lifted_by_id` and keeps the row.
- **Change.** To change a period, Venue Staff lift the block and record a new block. The unique period index applies only to the rows that are not lifted.

### Refusal order

Approval, amendment and the conflict flag give one reason for a refusal. The order is: an unavailable venue (closed hours or a block), a booking, a hold.

- Approval and amendment check availability first. Then they check the ledger with `checkVenueFree`, which names a block, a booking and a hold in that order.
- Hold creation and hold placement check only the ledger.

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

### A provenance column or a suspension join table for blocks

- Rejected: the rows in the period of a block are the rows that this block suspended, because live blocks at a venue never overlap.

### Store `'infinity'` as the open end of a block

- Rejected: the application reads timestamps as strings. The value `'infinity'` breaks these reads.

### Rebuild a restored row from the venue's current buffers

- Rejected: a venue buffer change during the block can make the lift fail. The lift uses the buffers that the pieces stored.

## Consequences

- As in ADR-5, the Drizzle snapshot, `db:push` and `db:pull` do not know the constraint. Never run `db:push` against a database that has 0048. `btree_gist` from 0019 stays required.
- The lock order of ADR-5 stays: the event key-share lock, then the venue advisory locks in ascending venue order, then the row locks. `handleConfirmEvent` writes no venue or occupancy row, so it takes no venue lock.
- The block writers reverse that order, because they start from a venue. They take the venue lock first. Then they key-share the affected events in ascending id order.
- The seed holds event rows `FOR UPDATE` and then takes a venue lock. If a seed and a block write run at the same time, they can deadlock.
- In that deadlock, PostgreSQL stops one transaction (40P01). When PostgreSQL stops a block handler, the handler refuses the change and tells Venue Staff to try again. The project accepts this risk, because the seed is a development tool.
- A lift fails when a new active row overlaps a restored row. Then the transaction rolls back, and the block stays live.
- While a block covers part of a source, the source has more than one ledger row. Until all the pieces are active again, a `checkVenueFree` refusal names the period of one piece.
- A block suspends an approved booking but does not release it. Venue Staff release or amend the booking. A lift restores the booking after an event cancellation, because the cancellation keeps the booking approved.
- A block over a confirmed event's booking returns the event to planning and clears its confirmation stamp; the event is not cancelled. The Coordinator sees each suspended booking and hold with the block's reason, read from the ledger, and may release a suspended booking in favour of a replacement, so the lift leaves the replacement standing. The confirmation gate refuses a booking a live block suspends.
- 0048 copies no existing booking or hold into the ledger, because no deployed database held live data when it shipped. A booking or hold from before 0048 blocks no other write until an amendment, or a release and a new hold, writes its row.
- Only the server functions and the seed write ledger rows. A hand-written change to a booking or a hold must change its `venue_occupancy` row in the same transaction.
- The seed takes the venue lock before it writes a block row or a booking row. The constraint is the authority for both.
- A hold request reserves no venue time, so another booking or hold can take its period first. Placement then re-checks the ledger and refuses the request. Placement refreshes the hold's buffers, because the venue can change its buffers while the request waits.
- Availability, search and the request queue still read the source tables until PTR-135 moves them to the ledger. Until then, they show bookings without buffers. The conflict flag reads the ledger with approval's expression, so it flags a request in the buffer of a booking.
