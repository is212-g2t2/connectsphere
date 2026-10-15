---
date: 2026-10-14
adr-number: ADR-8
status: accepted
---

# ADR-8: Venue blocks suspend and restore ledger rows

## Context

[ADR-7](./ADR-7-venue-occupancy-ledger.md) keeps every active commitment in `venue_occupancy` and leaves room for a suspension path. A venue block must refuse new bookings and holds. It must keep the bookings and holds that it covers, and Venue Staff must be able to lift it.

## Decision

A block is one `venue_unavailability` row and one `venue_occupancy` row with no event and buffers of 0. The block suspends the ledger rows that it covers, and a lift restores them.

- **Period.** A null end means "until lifted". `tsrange(start, null, '[)')` has no upper bound, so the ADR-7 constraint needs no change. A block cannot start on a day before today in venue local time.
- **Record.** The writer refuses a live block that overlaps the new period, because a block never suspends another block. A fully covered row becomes inactive and keeps its buffers. A partly covered row splits into an inactive covered piece and active remainders, each with absolute times and buffers of 0.
- **Lift.** The writer deletes the block's ledger row. It restores each suspended row whose booking is still approved or whose hold is still held, and deletes the other suspended rows. When all pieces of a split source are active again, one row replaces them: the source's own times, with buffers that reach to the first and the last piece.
- **Audit.** Record stamps `created_by_id` and `created_at`. Lift stamps `lifted_at` and `lifted_by_id` and keeps the row. To change a period, Venue Staff lift the block and record a new one, so the unique period index covers only rows that are not lifted.
- **Refusal order.** Approval, amendment and the conflict flag name one reason in this order: unavailable (closed hours or a block), then a booking, then a hold. Approval and amendment check availability first, then the ledger (`checkVenueFree`: block, booking, hold). Hold creation checks the ledger only.
- **Lock order.** The block writer starts from a venue, so it takes the venue advisory lock first. Then it key-shares the affected events in ascending id order, before it writes a ledger row.
- **Notices.** Record and lift raise one `venue_block_changed` notice for each affected event and recipient. The recipient is the event's assigned Coordinator, else the booking's requester, else the hold's owner. A lift sends no notice for a cancelled event.
- **Seed.** The seed records and lifts its blocks with the same ledger writes, without notices. A re-run lifts only the blocks that the seed created, then records them again with their ledger rows.

## Alternatives Considered

### A provenance column or a suspension join table

- Rejected: live blocks at a venue never overlap, so containment in the block's period identifies the rows that one block suspended.

### Storing `'infinity'` as the open end

- Rejected: the application reads timestamps as strings, and `'infinity'` breaks those reads.

### Rebuilding a restored row from the venue's current buffers

- Rejected: a venue buffer edit during the block would make the lift fail. The lift uses the buffers that the pieces stored.

## Consequences

- The block writers reverse the ADR-7 lock order. No current writer holds an event row exclusively while it waits for a venue lock, so no deadlock cycle exists. Review this order before a writer does that.
- A lift fails when a new active row overlaps a restored row. The transaction rolls back, and the block stays live.
- While a split source stays split, its pieces have buffers of 0. A later refusal names the period of a piece, not the source's window.
- A block suspends an approved booking but does not decide it. Venue Staff release or amend the booking, and an event cancellation keeps it approved, so a lift restores it.
- A block recorded before the ledger path has no ledger row. A re-run of `db:seed` records the seed's blocks again with ledger rows.
- Only Venue Staff (`venue:update`) record or lift a block. A calendar row shows the part of a block inside the selected range, and the lift dialog names the block's full period.
