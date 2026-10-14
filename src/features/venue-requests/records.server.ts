import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { venueRequests, venues } from "#/db/schema";
import type {
  EventVenueRequest,
  VenueRequestRejection,
  VenueRequestRelease,
} from "#/features/events/access";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";

/**
 * Keep this module server-only. A client-reachable value import of `#/db/schema` would ship the
 * full database schema to the browser. `events/records.server.ts` imports this module directly;
 * both files use the `.server.ts` suffix to stay out of client bundles. `requests.server.ts` also
 * imports `loadAssignedEvent` from the events feature.
 */

type Database = typeof Db;

/** The venue that Venue Staff suggested on a rejection. Join it with `leftJoin`. */
export const suggestedVenue = alias(venues, "suggested_venue");

/**
 * The columns that one event-card entry reads. Both entry readers select these, join `venues`
 * on the requested venue, and left-join `suggestedVenue`.
 */
export const venueRequestEntryColumns = {
  id: venueRequests.id,
  status: venueRequests.status,
  createdAt: venueRequests.createdAt,
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
};

/** One venue-request row as `venueRequestEntryColumns` selects it. */
interface VenueRequestEntryRow {
  id: string;
  status: VenueRequestStatus;
  createdAt: Date;
  updatedAt: Date;
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
 * PTR-35: Return the ids of the rejected rows that the Coordinator can still adjust. The adjust
 * link opens the suggested venue, else the rejected venue. A rejected row stops being adjustable
 * when another non-withdrawn row at that venue was created after the rejection. On a rejected
 * row, `updatedAt` is the rejection time. Pass the rows of one event.
 */
export function adjustableRejectionIds(
  rows: ReadonlyArray<{
    id: string;
    status: string;
    venueId: number;
    suggestedVenueId: number | null;
    createdAt: Date;
    updatedAt: Date;
  }>
): Set<string> {
  const adjustable = new Set<string>();
  for (const row of rows) {
    if (row.status !== "rejected") continue;
    const targetVenueId = row.suggestedVenueId ?? row.venueId;
    const answered = rows.some(
      other =>
        other.id !== row.id &&
        other.status !== "withdrawn" &&
        other.venueId === targetVenueId &&
        other.createdAt.getTime() > row.updatedAt.getTime()
    );
    if (!answered) adjustable.add(row.id);
  }
  return adjustable;
}

/**
 * PTR-34: The rejection a rejected row carries, with any suggestion. The `venue_requests` CHECK
 * requires a reason for rejected rows. Treat `null` as corrupt data, not as a blank card.
 */
function rejectionFromRow(row: VenueRequestEntryRow): VenueRequestRejection {
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
    venueId: row.venueId,
    venueName: row.venueName,
    date: row.startsAt.slice(0, 10),
    startTime: row.startsAt.slice(11, 16),
    endTime: row.endsAt.slice(11, 16),
    reason: row.rejectionReason,
    suggestion: Object.values(suggestion).every(part => part === null) ? null : suggestion,
    suggestedVenueId: row.suggestedVenueId,
  };
}

/** PTR-37: The release a released row carries. The CHECK requires a reason here too. */
function releaseFromRow(row: VenueRequestEntryRow): VenueRequestRelease {
  if (row.releaseReason === null) {
    throw new Error(`Released venue request ${row.id} has no reason recorded`);
  }
  return { reason: row.releaseReason, changedByName: row.lastChangedByStaffName };
}

/**
 * Build one event-card entry from one venue-request row. Never spread the database row:
 * `requestedById` and `assignedStaffId` must not reach a client. A rejected row carries its
 * rejection and a released row its release; other rows carry only their window. The caller
 * supplies the conflict kind and the `adjustable` mark, which need other rows.
 */
export function eventVenueRequestFromRow(
  row: VenueRequestEntryRow,
  marks: { conflict?: "booking" | "hold"; adjustable?: boolean } = {}
): EventVenueRequest {
  return {
    id: row.id,
    status: row.status,
    venueName: row.venueName,
    date: row.startsAt.slice(0, 10),
    startTime: row.startsAt.slice(11, 16),
    endTime: row.endsAt.slice(11, 16),
    ...(marks.conflict ? { conflict: marks.conflict } : {}),
    ...(row.status === "rejected" ? { rejection: rejectionFromRow(row) } : {}),
    ...(row.status === "released" ? { release: releaseFromRow(row) } : {}),
    ...(marks.adjustable ? { adjustable: true as const } : {}),
  };
}

/**
 * Return one event's venue requests in the projection's shape, earliest window first. Ignore
 * withdrawn rows. Each row carries its own state and its own rejection or release. Mark each
 * rejected row that the Coordinator can still adjust. The triage page reads this through the
 * coordination request, which has no venue data.
 */
export async function loadVenueRequestsForEvent(
  database: Pick<Database, "select">,
  eventId: number
): Promise<EventVenueRequest[]> {
  const rows = await database
    .select(venueRequestEntryColumns)
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .leftJoin(suggestedVenue, eq(suggestedVenue.id, venueRequests.suggestedVenueId))
    .where(eq(venueRequests.eventId, eventId))
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));

  const kept = rows.filter(row => row.status !== "withdrawn");
  const adjustable = adjustableRejectionIds(kept);
  return kept.map(row => eventVenueRequestFromRow(row, { adjustable: adjustable.has(row.id) }));
}
