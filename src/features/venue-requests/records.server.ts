import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { SelectedFields } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { eventRequests, venueOccupancy, venueRequests, venues } from "#/db/schema";
import type {
  EventVenueRequest,
  VenueRequestRejection,
  VenueRequestRelease,
} from "#/features/events/access";
import { isBlockRow, isHoldRow, overlapsLedger } from "#/features/venue-requests/occupancy.server";
import { canBeReplaced } from "#/features/venue-requests/schema";
import type {
  SessionRequirements,
  VenueRequestAnswerRow,
  VenueRequestConflict,
  VenueRequestStatus,
} from "#/features/venue-requests/schema";
import {
  eventRequirementColumns,
  loadWindowAvailabilityFailures,
} from "#/features/venues/records.server";

/**
 * Keep this module server-only. A client-reachable value import of `#/db/schema` would send the
 * full database schema to the browser. Only `.server.ts` modules import it:
 * `events/records.server.ts`, `coordination/assignments.server.ts`, `requests.server.ts`, and
 * `bookings.server.ts`.
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
    eventRequirementColumns.expectedAttendance
  ),
  layout: sessionValue<string>(venueRequests.layout, eventRequirementColumns.layout),
  accessibilityRequirements: sessionValue<string>(
    venueRequests.accessibilityRequirements,
    eventRequirementColumns.accessibilityRequirements
  ),
  requiredFacilities: sessionValue<string>(
    venueRequests.requiredFacilities,
    eventRequirementColumns.requiredFacilities
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
  /** PTR-165: the replacement chain and the Coordinator's dismissal. */
  replacesRequestId: venueRequests.replacesRequestId,
  dismissedAt: venueRequests.dismissedAt,
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
  replacesRequestId: string | null;
  dismissedAt: Date | null;
  requirements: SessionRequirements;
}

/**
 * The flag names one kind per request, in the refusal order of `checkVenueTakesBooking` (ADR-7):
 * the venue first (outside hours, then a block), then a booking, then a hold.
 */
const CONFLICT_RANK: Record<VenueRequestConflict, number> = {
  unavailable: 0,
  blocked: 1,
  booking: 2,
  hold: 3,
};

/** The kind of one overlapping ledger row. A block's row names the block. */
function ledgerConflictKind(row: { isHold: boolean; isBlock: boolean }): VenueRequestConflict {
  if (row.isBlock) return "blocked";
  return row.isHold ? "hold" : "booking";
}

/**
 * PTR-135 AC2: name the cause of a window that the venue cannot host. A block overlap reads
 * "Unavailable on …" in search's words (`availabilityFailure`); any other availability failure
 * means the venue is not open then.
 */
export function windowFailureConflictKind(failure: { message: string }): VenueRequestConflict {
  return failure.message.startsWith("Unavailable on") ? "blocked" : "unavailable";
}

/**
 * PTR-36 criterion 4, PTR-138 AC1: Return the conflict kind of each pending row in `pendingIds`
 * whose window approval would refuse now. Approval also refuses a request for session requirements
 * and for event status. The flag does not show these refusals. Name one kind per row, by
 * `CONFLICT_RANK`.
 *
 * - `booking`, `hold`: the row overlaps an approved booking or a held hold at its venue once the
 *   buffers count. Read the ledger with approval's expression (`overlapsLedger`).
 * - `blocked`: a recorded block overlaps the row's window, or a block's ledger row reaches it
 *   through the buffers. Read the blocks with `loadWindowAvailabilityFailures`, and a block's
 *   ledger row (`isBlockRow`) when the block reaches the row only through the buffers.
 * - `unavailable`: the venue is not open for the row's window.
 *
 * Read in batched queries, not one read per row. Do not scope the reads to the caller's events:
 * the booking or hold can belong to an event the caller cannot see. Return only the kind, never
 * the other event's name.
 */
export async function loadPendingConflictKinds(
  database: Pick<Database, "select">,
  pendingIds: readonly string[]
): Promise<Map<string, VenueRequestConflict>> {
  const kinds = new Map<string, VenueRequestConflict>();
  if (pendingIds.length === 0) return kinds;
  // The ids come from an earlier statement. A row approved since then would meet its own ledger
  // row and flag as conflicting, so read pending rows only.
  const isPending = and(
    inArray(venueRequests.id, [...pendingIds]),
    eq(venueRequests.status, "pending")
  );
  const [conflicts, windows] = await Promise.all([
    database
      .select({ id: venueRequests.id, isHold: isHoldRow, isBlock: isBlockRow })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .innerJoin(
        venueOccupancy,
        overlapsLedger({
          venueId: venueRequests.venueId,
          startsAt: venueRequests.startsAt,
          endsAt: venueRequests.endsAt,
          setupMinutes: venues.setupMinutes,
          turnaroundMinutes: venues.turnaroundMinutes,
        })
      )
      .where(isPending),
    database
      .select({
        id: venueRequests.id,
        venueId: venueRequests.venueId,
        operatingHours: venues.operatingHours,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(isPending),
  ]);
  const unavailable = await loadWindowAvailabilityFailures(database, windows);
  const found = [
    ...windows.flatMap((window, index) => {
      const failure = unavailable[index];
      if (failure === null) return [];
      return [{ id: window.id, kind: windowFailureConflictKind(failure) }];
    }),
    ...conflicts.map(row => ({ id: row.id, kind: ledgerConflictKind(row) })),
  ];
  for (const { id, kind } of found) {
    const named = kinds.get(id);
    if (named === undefined || CONFLICT_RANK[kind] < CONFLICT_RANK[named]) kinds.set(id, kind);
  }
  return kinds;
}

/**
 * PTR-35, PTR-165 AC5: Return the ids of the rejected rows that the Coordinator can still adjust.
 * The adjust link opens the suggested venue, else the rejected venue, and marks that this request
 * replaces the row. `canBeReplaced` therefore decides the mark too: a row whose replacement already
 * exists, or which the Coordinator dismissed, has nothing left to adjust. Pass the rows of one
 * event.
 */
export function adjustableRejectionIds(rows: ReadonlyArray<VenueRequestAnswerRow>): Set<string> {
  const adjustable = new Set<string>();
  for (const row of rows) {
    if (row.status !== "rejected") continue;
    if (canBeReplaced(row, rows)) adjustable.add(row.id);
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
 * rejection, and a released row carries its release.
 *
 * The caller sets the marks, which need other rows or the viewer's role: the conflict kind, the
 * `adjustable` mark, and `requirements` (Coordinator only). PTR-165 adds `dismissed` from the row
 * itself; the card derives whether the Coordinator can still dismiss a settled entry.
 */
export function eventVenueRequestFromRow(
  row: VenueRequestEntryRow,
  marks: {
    conflict?: VenueRequestConflict;
    adjustable?: boolean;
    requirements?: boolean;
  } = {}
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
    ...(row.dismissedAt !== null ? { dismissed: true as const } : {}),
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
