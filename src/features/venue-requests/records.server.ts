import { asc, eq } from "drizzle-orm";
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
 * The decided outcome one venue-request row carries. Rejections and releases stay visible on
 * their own row beside other rows. Join the suggested venue name for rejection cards.
 */
type VenueRequestOutcome =
  | { id: string; status: "rejected"; venueName: string; rejection: VenueRequestRejection }
  | { id: string; status: "released"; venueName: string; release: VenueRequestRelease };

/** One venue-request row with its venue names, as the outcome readers select it. */
interface VenueRequestOutcomeRow {
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

/**
 * Return the decided outcome one row carries, or null when the row holds no staff decision.
 * Approved and pending rows carry none.
 */
function venueRequestOutcomeFromRow(row: VenueRequestOutcomeRow): VenueRequestOutcome | null {
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

/**
 * Return the id of the newest row by `updatedAt` (tie-break greater id), or null when empty.
 * Each reader marks `latest` over its own visible rows, so each passes its own candidate set.
 */
export function latestVenueRequestId(
  rows: ReadonlyArray<{ id: string; updatedAt: Date }>
): string | null {
  if (rows.length === 0) return null;
  let latest = rows[0];
  for (const row of rows.slice(1)) {
    if (
      row.updatedAt.getTime() > latest.updatedAt.getTime() ||
      (row.updatedAt.getTime() === latest.updatedAt.getTime() && row.id > latest.id)
    ) {
      latest = row;
    }
  }
  return latest.id;
}

/**
 * Build one event-card entry from one venue-request row, field by field. Never spread the
 * database row: `requestedById` and `assignedStaffId` must not reach a client. Decided rows
 * carry their own rejection or release; other rows carry only their window.
 */
export function eventVenueRequestFromRow(row: VenueRequestOutcomeRow): EventVenueRequest {
  const entry: EventVenueRequest = {
    id: row.id,
    status: row.status,
    venueName: row.venueName,
    date: row.startsAt.slice(0, 10),
    startTime: row.startsAt.slice(11, 16),
    endTime: row.endsAt.slice(11, 16),
  };
  const outcome = venueRequestOutcomeFromRow(row);
  if (outcome?.status === "rejected") entry.rejection = outcome.rejection;
  if (outcome?.status === "released") entry.release = outcome.release;
  return entry;
}

/**
 * Return one event's venue requests in the projection's shape, earliest window first. Ignore
 * withdrawn rows. Each row carries its own state and its own rejection or release. Mark the
 * newest non-withdrawn row (by `updatedAt`, tie-break greater id) with `latest`. The triage
 * page reads this through the coordination request, which has no venue data.
 */
export async function loadVenueRequestsForEvent(
  database: Pick<Database, "select">,
  eventId: number
): Promise<EventVenueRequest[]> {
  const suggestedVenue = alias(venues, "suggested_venue");
  const rows = await database
    .select({
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
    .where(eq(venueRequests.eventId, eventId))
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));

  const kept = rows.filter(row => row.status !== "withdrawn");
  const entries = kept.map(row => eventVenueRequestFromRow(row));
  const latestId = latestVenueRequestId(kept);
  if (latestId !== null) {
    const latestEntry = entries.find(entry => entry.id === latestId);
    if (latestEntry) latestEntry.latest = true;
  }
  return entries;
}
