---
date: 2026-10-14
adr-number: ADR-8
status: accepted
---

# ADR-8: Session requirements and same-event checks on each venue request

## Context

One event can book several venues, and the same venue for several sessions (PTR-138). A main programme and a breakout room need different requirements. A breakout room for 30 people fails an event that expects 300, so suitability must use each session's own requirements.

[ADR-7](./ADR-7-venue-occupancy-ledger.md) guards committed venue time with the `venue_occupancy` ledger. A pending request has no ledger row. ADR-7 rejects an application-level overlap check as the guarantee for venue time, because two writers can both pass a read-then-write check.

## Decision

Each venue request carries its own session requirements, and the request writers check each venue on its own.

| Part                 | Rule                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session requirements | `venue_requests` stores `expected_attendance`, `layout`, `accessibility_requirements` and `required_facilities`. They start from the event's requirements. Creation always stores `layout`, so a null `layout` marks a row from before this decision.                                                                                                                               |
| Legacy rows          | A row with a null `layout` reads the event's current requirements in place of all four values. `selectVenueRequestEntries` applies this rule for every reader.                                                                                                                                                                                                                      |
| Suitability          | Request creation, hold conversion, approval and an amendment to another venue refuse a venue that fails the session's requirements. They use search's rule, `requirementFailures`. Approval checks again, because the venue or a legacy row's event can change after creation. An amendment within one venue changes neither the venue nor the requirements, so it skips the check. |
| Availability         | Approval and amendment refuse a window that the venue cannot host: it is not open then, or a recorded block overlaps it. They use search's availability rule (`windowAvailabilityFailure`). Creation accepts such a window and flags it, because a block can be lifted.                                                                                                             |
| Same-event overlap   | Creation, hold conversion and amendment refuse a window that overlaps a session of the same event at the venue, with the setup and turnaround time counted (ADR-7). The rule runs under the venue advisory lock.                                                                                                                                                                    |
| Conflict flag        | A pending request carries `booking`, `hold` or `unavailable` when approval would refuse it now. The flag reads the ledger with approval's expression (`overlapsLedger`) and the same availability rule.                                                                                                                                                                             |

The same-event rule reads two sources:

- **Bookings and holds**: the event's ledger rows, with the buffers stored on each row and the venue's current buffers around the new window. Approval uses the same expression, so the rule and approval agree after a buffer change.
- **Pending requests**: the event's pending rows at the venue, with the venue's current buffers on both sides. An exact duplicate gets the duplicate message. The partial unique index `venue_requests_pending_event_venue_window_idx` refuses a duplicate from a writer outside the lock.

This check is not the guarantee that ADR-7 rejects. It guards pending requests, which hold no venue time. The ledger constraint stays the only guarantee for committed time. If a writer bypasses the check, approval of the second overlapping request fails at the ledger.

## Alternatives Considered

### Give pending requests ledger rows

- Pros: one constraint would cover pending requests too.
- Cons: a pending request would block the requests and holds of other events. PTR-31 lets requests of different events overlap until Venue Staff decide.
- Rejected: it changes who can request a venue.

### Keep the requirements on the event only

- Pros: no new columns.
- Cons: strict suitability would refuse every breakout room that is smaller than the main programme.
- Rejected: it cannot describe a second session.

### Copy the event's requirements into old rows with a data migration

- Pros: readers would need no fallback.
- Cons: the copy needs handwritten SQL, which the migration rules forbid. It would also freeze values that nobody checked against the venue.
- Rejected: the null-`layout` fallback keeps old rows in step with their event.

### Refuse an unavailable venue at creation

- Pros: the Coordinator learns of a closed or blocked venue at once.
- Cons: a block can be lifted and opening hours can change before Venue Staff decide.
- Rejected: the request records the need. The flag warns, and approval enforces.

### A database constraint for the same-event rule

- Rejected for the reason in ADR-7: an index expression cannot read the venue's current buffers, and one constraint cannot span `venue_requests` and `venue_occupancy`.

## Consequences

- The conflict flags read the ledger. This replaces the last ADR-7 consequence for the flags only. Availability and search still read the source tables until PTR-135.
- A booking from before migration 0048 has no ledger row. It sets no flag and blocks no approval, as ADR-7 states.
- Approval can refuse a request that was valid when it was raised. The flag shows the reason before Venue Staff decide.
- Hold creation applies the same-event rule too, so a hold and a pending request of one event overlap only after a later change to the venue's buffers.
- The lock order of ADR-7 stays: the event key-share lock, then the venue advisory locks in ascending venue order, then the row locks.
