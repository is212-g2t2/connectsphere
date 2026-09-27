import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { venueRequests, venues } from "#/db/schema";
import type { VenueRequestRejection } from "#/features/events/access";

/**
 * Server-only on purpose: `#/db/schema` is a value import here, which would ship the whole
 * database schema to the browser from any module a route can reach. `events/records.server.ts`
 * reaches this through a plain import — both modules already carry the `.server.ts` suffix that
 * keeps either one out of a client bundle, the same way `requests.server.ts` already imports
 * `loadAssignedEvent` from the events feature in the other direction.
 */

type Database = typeof Db;

/**
 * PTR-34 criterion 3, owned here rather than re-derived by the events feature (which would
 * otherwise read `venue_requests` and `venues` directly, and PTR-35 prefill would need to do it
 * again): the most recent rejection for each of the given events, shaped for a Coordinator's card
 * or a prefill. Only an event whose newest row of *any* status is that rejection is included — a
 * rejection followed by a fresh pending, approved or withdrawn row is no longer the event's live
 * state, and it is not this reader's business to reach further back than the newest row. One join
 * carries the suggested venue's name, so a caller never reads `venues` for this itself.
 */
export async function loadRejectionsForEvents(
  database: Pick<Database, "select">,
  eventIds: readonly number[]
): Promise<Map<number, VenueRequestRejection>> {
  if (eventIds.length === 0) return new Map();

  const suggestedVenue = alias(venues, "suggested_venue");
  const rows = await database
    .select({
      eventId: venueRequests.eventId,
      id: venueRequests.id,
      status: venueRequests.status,
      updatedAt: venueRequests.updatedAt,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      rejectionReason: venueRequests.rejectionReason,
      suggestedVenueName: suggestedVenue.name,
      suggestedDate: venueRequests.suggestedDate,
      suggestedStartTime: venueRequests.suggestedStartTime,
      suggestedEndTime: venueRequests.suggestedEndTime,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .leftJoin(suggestedVenue, eq(suggestedVenue.id, venueRequests.suggestedVenueId))
    .where(inArray(venueRequests.eventId, [...eventIds]));

  // The newest row per event, any status; a tie (same instant) falls to the higher id, the same
  // stable rule the single-event reader used before this moved.
  const newestByEvent = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    const current = newestByEvent.get(row.eventId);
    if (
      !current ||
      row.updatedAt.getTime() > current.updatedAt.getTime() ||
      (row.updatedAt.getTime() === current.updatedAt.getTime() && row.id > current.id)
    ) {
      newestByEvent.set(row.eventId, row);
    }
  }

  const rejections = new Map<number, VenueRequestRejection>();
  for (const [eventId, row] of newestByEvent) {
    if (row.status !== "rejected") continue;
    // The CHECK on `venue_requests` guarantees a rejected row has a reason; null here is data
    // corruption to surface loudly, not a blank card to render quietly.
    if (row.rejectionReason === null) {
      throw new Error(`Rejected venue request ${row.id} has no reason recorded`);
    }
    const suggestion = {
      venueName: row.suggestedVenueName,
      date: row.suggestedDate,
      startTime: row.suggestedStartTime?.slice(0, 5) ?? null,
      endTime: row.suggestedEndTime?.slice(0, 5) ?? null,
    };
    rejections.set(eventId, {
      venueName: row.venueName,
      date: row.startsAt.slice(0, 10),
      startTime: row.startsAt.slice(11, 16),
      endTime: row.endsAt.slice(11, 16),
      reason: row.rejectionReason,
      suggestion: Object.values(suggestion).every(part => part === null) ? null : suggestion,
    });
  }
  return rejections;
}
