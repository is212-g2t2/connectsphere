import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { venueRequests, venues } from "#/db/schema";
import type {
  EventVenueRequest,
  VenueRequestRejection,
  VenueRequestRelease,
} from "#/features/events/access";

/**
 * Keep this module server-only. A client-reachable value import of `#/db/schema` would ship the
 * full database schema to the browser. `events/records.server.ts` imports this module directly;
 * both files use the `.server.ts` suffix to stay out of client bundles. `requests.server.ts` also
 * imports `loadAssignedEvent` from the events feature.
 */

type Database = typeof Db;

/**
 * Return the latest operational outcome for each event. Ignore withdrawals because they contain
 * no staff decision. A release replaces an older rejection and remains visible with its reason and
 * actor label. Join the suggested venue name for rejection cards.
 */
export type VenueRequestOutcome =
  | { id: string; status: "rejected"; venueName: string; rejection: VenueRequestRejection }
  | { id: string; status: "released"; venueName: string; release: VenueRequestRelease };

/** One venue-request row with its venue names, as the outcome readers select it. */
export interface VenueRequestOutcomeRow {
  eventId: number;
  id: string;
  status: string;
  updatedAt: Date;
  assignedStaffId: string | null;
  venueId: number;
  venueName: string;
  startsAt: string;
  endsAt: string;
  rejectionReason: string | null;
  releaseReason: string | null;
  lastChangedByStaffName: string | null;
  suggestedVenueId: number | null;
  suggestedVenueName: string | null;
  suggestedDate: string | null;
  suggestedStartTime: string | null;
  suggestedEndTime: string | null;
}

/** The decided outcome one row carries, or null when the row holds no staff decision. */
export function venueRequestOutcomeFromRow(
  row: VenueRequestOutcomeRow
): VenueRequestOutcome | null {
  if (row.status === "released") {
    if (row.releaseReason === null) {
      throw new Error(`Released venue request ${row.id} has no reason recorded`);
    }
    return {
      status: "released",
      id: row.id,
      venueName: row.venueName,
      release: {
        venueName: row.venueName,
        date: row.startsAt.slice(0, 10),
        startTime: row.startsAt.slice(11, 16),
        endTime: row.endsAt.slice(11, 16),
        reason: row.releaseReason,
        changedByName: row.lastChangedByStaffName,
      },
    };
  }
  if (row.status !== "rejected") return null;
  // The `venue_requests` CHECK requires a reason for rejected rows. Treat `null` as corrupt data,
  // not as a blank card.
  if (row.rejectionReason === null) {
    throw new Error(`Rejected venue request ${row.id} has no reason recorded`);
  }
  const suggestion = {
    venueName: row.suggestedVenueName,
    date: row.suggestedDate,
    startTime: row.suggestedStartTime?.slice(0, 5) ?? null,
    endTime: row.suggestedEndTime?.slice(0, 5) ?? null,
  };
  return {
    status: "rejected",
    id: row.id,
    venueName: row.venueName,
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
  };
}

export async function loadVenueRequestOutcomesForEvents(
  database: Pick<Database, "select">,
  eventIds: readonly number[],
  assignedStaffId?: string
): Promise<Map<number, VenueRequestOutcome>> {
  if (eventIds.length === 0) return new Map();

  const suggestedVenue = alias(venues, "suggested_venue");
  const rows = await database
    .select({
      eventId: venueRequests.eventId,
      id: venueRequests.id,
      status: venueRequests.status,
      updatedAt: venueRequests.updatedAt,
      assignedStaffId: venueRequests.assignedStaffId,
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

  // Select the newest decided row per event. Ignore withdrawals and later pending requests; a
  // pending adjusted request must not hide the rejection it answers. Break equal-time ties by the
  // greater id string, as the single-event reader does.
  const newestByEvent = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.status === "withdrawn" || row.status === "pending") continue;
    // Staff see only their own settled rows. The Coordinator's unfiltered call stays the same.
    if (assignedStaffId !== undefined && row.assignedStaffId !== assignedStaffId) continue;
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
    const outcome = venueRequestOutcomeFromRow(row);
    if (outcome) outcomes.set(eventId, outcome);
  }
  return outcomes;
}

/**
 * Return one event's latest live venue request in the projection's shape. Ignore withdrawn rows.
 * Return pending rows as-is and decided rows as outcomes. The triage page reads this through the
 * coordination request, which has no venue data.
 */
export async function loadVenueRequestForEvent(
  database: Pick<Database, "select">,
  eventId: number
): Promise<EventVenueRequest | null> {
  const suggestedVenue = alias(venues, "suggested_venue");
  const rows = await database
    .select({
      eventId: venueRequests.eventId,
      id: venueRequests.id,
      status: venueRequests.status,
      updatedAt: venueRequests.updatedAt,
      assignedStaffId: venueRequests.assignedStaffId,
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
    .where(eq(venueRequests.eventId, eventId));

  // Select the newest live row by update time. Break ties with the greater id string, as the
  // multi-event reader does. A withdrawal is not a request.
  let newest: VenueRequestOutcomeRow | null = null;
  for (const row of rows) {
    if (row.status === "withdrawn") continue;
    if (
      !newest ||
      row.updatedAt.getTime() > newest.updatedAt.getTime() ||
      (row.updatedAt.getTime() === newest.updatedAt.getTime() && row.id > newest.id)
    ) {
      newest = row;
    }
  }
  if (!newest) return null;
  if (newest.status === "pending") {
    return { id: newest.id, status: newest.status, venueName: newest.venueName };
  }
  return (
    venueRequestOutcomeFromRow(newest) ?? {
      id: newest.id,
      status: newest.status,
      venueName: newest.venueName,
    }
  );
}
