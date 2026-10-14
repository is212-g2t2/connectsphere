---
date: 2026-10-14
adr-number: ADR-8
status: accepted
---

# ADR-8: Venue blocks suspend and restore ledger rows

## Context

[ADR-7](./ADR-7-venue-occupancy-ledger.md) reserved the suspension path for PTR-136. A venue block must refuse new bookings and holds, accept existing ones, and be liftable. ADR-7's columns were not enough: no end, no lift or creator stamps.

## Decision

A block is one `venue_unavailability` row plus one `venue_occupancy` row with buffers 0 and no event. A null end means unbounded; `tsrange(start, null, '[)')` already gives the 0048 constraint its upper-unbounded range, so no `'infinity'` value and no constraint change is needed.

Recording probes `venue_unavailability` for a live overlap (a live block can exist before its ledger row) and then suspends each active booking or hold row the block covers: a fully covered row flips to `active = false` and keeps its buffers; a partial cover deletes the row and inserts the intersection inactive plus the remainders active, all with absolute extents and buffers 0. A block never suspends or restores another block, so overlapping blocks are refused.

Refusals: approval and amendment probe the ledger first and name a booking or a hold immediately; they defer a block conflict until availability answers, so a block they can see is named with its reason and day (`cannot host this window`), as the request panel flags it. A block that reaches only into the requested buffers, or has no ledger row yet (the pre-PTR-136 upgrade path), keeps the block-period refusal. A hold creation has no availability check, so the ledger check names its block.

Lifting deletes the block's ledger row, then restores every contained inactive row whose source is still approved or held; it deletes the rest. It flips `active` only: no buffer recompute and no venue-buffer read. A deliberate replacement deleted its own rows, so the lift cannot fail because of it. An out-of-band writer can still leave a conflict; then the transaction fails, the block stays, and the refusal is readable.

The constraint is immediate, so the statement order is fixed: suspend (deactivate or delete then insert pieces) before the block's ledger row; on lift, delete the block's ledger row before reactivating pieces.

Audit: `created_by_id`/`created_at` on record, `lifted_at`/`lifted_by_id` on lift. There is no delete and no in-place edit: a different period is a lift and a new block. The unique period index is partial (`where lifted_at is null`) so a period can be recorded again after a lift.

Lock order: the block writer takes the venue advisory lock first (it starts from a venue), then key-shares the affected events in ascending id order before any ledger row write, then writes and raises notices. The notification insert takes the event key-share through its foreign key. No current writer holds an event row exclusively while it waits for a venue lock, so no deadlock cycle exists. A future writer that does must key-share the affected events first. The seed takes the venue lock for its block writes but key-shares no event, as ADR-7 already exempts its booking writes.

Notices: one `venue_block_changed` notification per affected event (action `blocked` or `lifted`, the block period, the reason), sent to the event's assigned Coordinator, else the request raiser, else the hold owner. A replaced arrangement raises nothing on lift; the Coordinator already saw the replacement notice.

The seed: its block pass lifts the previous seed periods and re-records them in one transaction under the venue lock, and writes the block ledger rows. A period that another live block covers is skipped, so the seed keeps its re-run contract. Its booking pass writes a covered booking suspended. The seed raises no notices.

AC4 reading: "cancelled" means the arrangement was released, withdrawn, rejected or amended. An event cancellation deliberately keeps the booking approved (PTR-54), so the lift restores it and Venue Staff release it.

## Alternatives Considered

### A provenance column or suspension join table

- Rejected: ADR-7's containment identifies exactly one block's pieces because blocks are disjoint.

### Storing `'infinity'`

- Rejected: breaks the timestamp string reads.

### Recomputing a restored row from the source and venue buffers

- Rejected: a later buffer edit would make the lift fail.

## Consequences

- Split pieces keep buffers 0, so the occupied extent stays exact but PTR-132's buffer report will list a split commitment.
- Where several rows cover one source, a later refusal names the piece's period, not the source window (PTR-135 moves the readers to the ledger).
- Blocks are managed from the calendar's selected range, and only `venue:update` (Venue Staff) records or lifts.
- This story suspends the covered rows and notifies their Coordinators; surfacing the affected arrangements for re-planning is PTR-137.
- While a block suspends an approved booking, the same-event overlap rule reads the ledger's active rows, so a second request for that event over the suspended window is not refused at creation. The request panel flags it `unavailable` and approval refuses it.
- A calendar row shows the part of a block inside the selected range; the lift dialog names the block's true period.
- A block recorded before this story has no ledger row. Approval names it through availability, and the ledger check refuses a hold over it, until a seed run writes the row.
