import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { SelectedFields } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { eventRequests, venueHolds, venueRequests, venues } from "#/db/schema";
import type {
  EventVenueRequest,
  VenueRequestRejection,
  VenueRequestRelease,
} from "#/features/events/access";
import { holdOccupancy } from "#/features/venue-requests/hold-occupancy.server";
import type { SessionRequirements, VenueRequestStatus } from "#/features/venue-requests/schema";

/**
 * Keep this module server-only. A client-reachable value import of `#/db/schema` would ship the
 * full database schema to the browser. `events/records.server.ts` imports this module directly;
 * both files use the `.server.ts` suffix to stay out of client bundles. `requests.server.ts`
 * imports it for the Venue Staff decision read.
 */

type Database = typeof Db;

/**
 * PTR-138 AC1: a row from before session requirements. Creation always stores a layout, blank or
 * not, so a null layout marks only these rows.
 */
const isLegacyRow = sql`${venueRequests.layout} is null`;

/** Read the stored session value, or the event's current value for a legacy row. */
function sessionValue<T>(stored: SQLWrapper, event: SQLWrapper) {
  return sql<T>`case when ${isLegacyRow} then ${event} else ${stored} end`;
}

/**
 * PTR-138 AC1: a request's own session requirements. A legacy row reads the event's current
 * requirements in their place. A newer row returns what it stores, a null attendance included.
 */
const sessionRequirementColumns = {
  expectedAttendance: sessionValue<number | null>(
    venueRequests.expectedAttendance,
    eventRequests.expectedAttendance
  ),
  layout: sessionValue<string>(venueRequests.layout, eventRequests.roomLayoutPreference),
  accessibilityRequirements: sessionValue<string>(
    venueRequests.accessibilityRequirements,
    eventRequests.accessibilityRequirements
  ),
  requiredFacilities: sessionValue<string>(
    venueRequests.requiredFacilities,
    eventRequests.venueRequirements
  ),
};

/** The venue that Venue Staff suggested on a rejection. */
const suggestedVenue = alias(venues, "suggested_venue");

/** The columns that one event-card entry reads. `selectVenueRequestEntries` adds their joins. */
const venueRequestEntryColumns = {
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
  requirements: sessionRequirementColumns,
};

/**
 * Select venue-request rows with their entry columns, session requirements included, plus
 * `extra`. Join the requested venue, the event that legacy rows read, and the suggested venue.
 * Every reader of entries or session requirements starts here, then adds `where` and `orderBy`.
 */
export function selectVenueRequestEntries<TExtra extends SelectedFields>(
  database: Pick<Database, "select">,
  extra: TExtra
) {
  return database
    .select({ ...venueRequestEntryColumns, ...extra })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .innerJoin(eventRequests, eq(eventRequests.id, venueRequests.eventId))
    .leftJoin(suggestedVenue, eq(suggestedVenue.id, venueRequests.suggestedVenueId));
}

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
  requirements: SessionRequirements;
}

/** An approved booking that a pending request can overlap. */
const approvedBooking = alias(venueRequests, "approved_booking");

/**
 * PTR-36 criterion 4: Return the conflict kind of each pending row in `pendingIds`. A row
 * conflicts when it overlaps an approved booking or an active hold at its venue. A booking
 * outranks a hold, as the staff queue shows it. Use one self-join per kind, not a read per row.
 * Do not scope the joins to the caller's events: the booking or hold can belong to an event the
 * caller cannot see. Return only the kind, never the other event.
 */
export async function loadPendingConflictKinds(
  database: Pick<Database, "select">,
  pendingIds: readonly string[]
): Promise<Map<string, "booking" | "hold">> {
  const kinds = new Map<string, "booking" | "hold">();
  if (pendingIds.length === 0) return kinds;
  // Compare the hold's occupied period, not its requested times: a hold conflicts through its
  // stored buffers too. `loadVenueHolds` applies the same rule, so the badge and the calendar
  // agree.
  const { occupiedStart, occupiedEnd } = holdOccupancy();
  const [bookingConflicts, holdConflicts] = await Promise.all([
    database
      .select({ id: venueRequests.id })
      .from(venueRequests)
      .innerJoin(
        approvedBooking,
        and(
          eq(approvedBooking.venueId, venueRequests.venueId),
          eq(approvedBooking.status, "approved"),
          lt(venueRequests.startsAt, approvedBooking.endsAt),
          gt(venueRequests.endsAt, approvedBooking.startsAt)
        )
      )
      .where(
        and(
          inArray(venueRequests.id, [...pendingIds]),
          // The ids come from an earlier statement. A row approved since then would join itself
          // and flag as conflicting, because a period always overlaps itself.
          eq(venueRequests.status, "pending")
        )
      ),
    database
      .select({ id: venueRequests.id })
      .from(venueRequests)
      .innerJoin(
        venueHolds,
        and(
          eq(venueHolds.venueId, venueRequests.venueId),
          eq(venueHolds.status, "held"),
          lt(venueRequests.startsAt, occupiedEnd),
          gt(venueRequests.endsAt, occupiedStart)
        )
      )
      .where(and(inArray(venueRequests.id, [...pendingIds]), eq(venueRequests.status, "pending"))),
  ]);
  for (const row of bookingConflicts) kinds.set(row.id, "booking");
  for (const row of holdConflicts) {
    if (!kinds.has(row.id)) kinds.set(row.id, "hold");
  }
  return kinds;
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
    status: VenueRequestStatus;
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
 * supplies the conflict kind and the `adjustable` mark, which need other rows. It also sets
 * `requirements` for the Coordinator, who states each session's requirements.
 */
export function eventVenueRequestFromRow(
  row: VenueRequestEntryRow,
  marks: { conflict?: "booking" | "hold"; adjustable?: boolean; requirements?: boolean } = {}
): EventVenueRequest {
  return {
    id: row.id,
    status: row.status,
    venueName: row.venueName,
    date: row.startsAt.slice(0, 10),
    startTime: row.startsAt.slice(11, 16),
    endTime: row.endsAt.slice(11, 16),
    ...(marks.requirements ? { requirements: row.requirements } : {}),
    ...(marks.conflict ? { conflict: marks.conflict } : {}),
    ...(row.status === "rejected" ? { rejection: rejectionFromRow(row) } : {}),
    ...(row.status === "released" ? { release: releaseFromRow(row) } : {}),
    ...(marks.adjustable ? { adjustable: true as const } : {}),
  };
}

/**
 * Return one event's venue requests in the Coordinator's projection shape, earliest window first.
 * Ignore withdrawn rows. Each row carries its own state, session requirements, and rejection or
 * release. Mark each rejected row that the Coordinator can still adjust. The triage page reads
 * this through the coordination request, which has no venue data.
 */
export async function loadVenueRequestsForEvent(
  database: Pick<Database, "select">,
  eventId: number
): Promise<EventVenueRequest[]> {
  const rows = await selectVenueRequestEntries(database, {})
    .where(eq(venueRequests.eventId, eventId))
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));

  const kept = rows.filter(row => row.status !== "withdrawn");
  const adjustable = adjustableRejectionIds(kept);
  return kept.map(row =>
    eventVenueRequestFromRow(row, { adjustable: adjustable.has(row.id), requirements: true })
  );
}
