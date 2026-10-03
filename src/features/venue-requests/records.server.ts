import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { venueRequests, venues } from "#/db/schema";
import type { VenueRequestRejection, VenueRequestRelease } from "#/features/events/access";

/**
 * Server-only on purpose: `#/db/schema` is a value import here, which would ship the whole
 * database schema to the browser from any module a route can reach. `events/records.server.ts`
 * reaches this through a plain import — both modules already carry the `.server.ts` suffix that
 * keeps either one out of a client bundle, the same way `requests.server.ts` already imports
 * `loadAssignedEvent` from the events feature in the other direction.
 */

type Database = typeof Db;

/**
 * The latest operational outcome for each event. Withdrawals remain invisible because they carry
 * no staff decision, while a release supersedes an older rejection and remains visible with its
 * reason and durable actor label. One join carries the suggested venue's name for rejection cards.
 */
export type VenueRequestOutcome =
  | { status: "rejected"; rejection: VenueRequestRejection }
  | { status: "released"; release: VenueRequestRelease };

export async function loadVenueRequestOutcomesForEvents(
  database: Pick<Database, "select">,
  eventIds: readonly number[]
): Promise<Map<number, VenueRequestOutcome>> {
  if (eventIds.length === 0) return new Map();

  const suggestedVenue = alias(venues, "suggested_venue");
  const rows = await database
    .select({
      eventId: venueRequests.eventId,
      id: venueRequests.id,
      status: venueRequests.status,
      updatedAt: venueRequests.updatedAt,
      venueId: venueRequests.venueId,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      rejectionReason: venueRequests.rejectionReason,
      releaseReason: venueRequests.releaseReason,
      lastChangedByStaffName: venueRequests.lastChangedByStaffName,
      suggestedVenueId: venueRequests.suggestedVenueId,
      suggestedVenueName: suggestedVenue.name,
      suggestedDate: venueRequests.suggestedDate,
      suggestedStartTime: venueRequests.suggestedStartTime,
      suggestedEndTime: venueRequests.suggestedEndTime,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .leftJoin(suggestedVenue, eq(suggestedVenue.id, venueRequests.suggestedVenueId))
    .where(inArray(venueRequests.eventId, [...eventIds]));

  // The newest decided row per event: a withdrawal is not a decision, and a pending request
  // raised after a rejection (an adjusted request) must not hide the rejection it answers. A tie
  // (same instant) falls to the greater id string, the same stable rule the single-event reader
  // used.
  const newestByEvent = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.status === "withdrawn" || row.status === "pending") continue;
    const current = newestByEvent.get(row.eventId);
    if (
      !current ||
      row.updatedAt.getTime() > current.updatedAt.getTime() ||
      (row.updatedAt.getTime() === current.updatedAt.getTime() && row.id > current.id)
    ) {
      newestByEvent.set(row.eventId, row);
    }
  }

  const outcomes = new Map<number, VenueRequestOutcome>();
  for (const [eventId, row] of newestByEvent) {
    if (row.status === "released") {
      if (row.releaseReason === null) {
        throw new Error(`Released venue request ${row.id} has no reason recorded`);
      }
      outcomes.set(eventId, {
        status: "released",
        release: {
          venueName: row.venueName,
          date: row.startsAt.slice(0, 10),
          startTime: row.startsAt.slice(11, 16),
          endTime: row.endsAt.slice(11, 16),
          reason: row.releaseReason,
          changedByName: row.lastChangedByStaffName,
        },
      });
      continue;
    }
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
    outcomes.set(eventId, {
      status: "rejected",
      rejection: {
        venueId: row.venueId,
        venueName: row.venueName,
        date: row.startsAt.slice(0, 10),
        startTime: row.startsAt.slice(11, 16),
        endTime: row.endsAt.slice(11, 16),
        reason: row.rejectionReason,
        suggestion: Object.values(suggestion).every(part => part === null) ? null : suggestion,
        suggestedVenueId: row.suggestedVenueId,
      },
    });
  }
  return outcomes;
}
