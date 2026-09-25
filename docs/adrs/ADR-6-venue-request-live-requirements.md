---
date: 2026-09-25
adr-number: ADR-6
status: accepted
---

# ADR-6: Pending booking request detail reads live event requirements

## Context

Venue Staff open a pending booking request from the queue and need the event's requirements to judge it. `venue_requests` stores the venue, the requested period and the raiser; it does not store a copy of the event's requirements.

PTR-31 lets an Event Coordinator edit an event's requirements while a booking request for it is pending. A snapshot taken at submission would drift from the event it describes, and nothing on the venue request row marks that drift.

## Decision

The detail handler joins `venue_requests` to `event_requests` on `event_id` and reads the requirement fields at read time. `handleGetPendingVenueRequest` (`src/features/venue-requests/requests.server.ts`) returns `eventTiming`, `expectedAttendance`, `layout`, `accessibility` and `requiredFacilities` from the current event row.

The queue stays a projection of the venue request row alone. `handleListPendingVenueRequests` reads only `venue_requests` joined to `venues`, so the list does not pay for the extra join and never shows requirement fields.

The detail handler returns no row once a request has left `pending`, and names no event or conflicting-event details; those stay outside the Venue Staff contract.

## Alternatives Considered

### Snapshot requirements onto `venue_requests` at submission

- Pros: detail is a single-table read, and a later event edit cannot change what Venue Staff review.
- Cons: adds five columns and a backfill, and the review then describes requirements the event no longer carries.
- Rejected: the live read is the current contract and needs no schema change.

## Consequences

- An event edit while the request is pending changes what Venue Staff see on the detail view. The queue's venue, period and submission instant do not change.
- No historical snapshot exists. The event row is the only source, so a later requirement change is not recoverable from the request.
- The detail query adds one inner join. A request whose event row is missing returns no row, which the route turns into its 404.
