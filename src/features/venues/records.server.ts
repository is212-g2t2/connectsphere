import { and, asc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import {
  eventRequests,
  venueBufferChanges,
  venueHolds,
  venueOccupancy,
  venueRequests,
  venueUnavailability,
  venues,
} from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { eventTiming } from "#/features/events/access";
import type { NotificationPayloads } from "#/features/notifications/message";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { canConvertHold, canReleaseHold } from "#/features/venue-requests/holds";
import { isDeadlock, overlapsPeriod } from "#/features/venue-requests/occupancy.server";
import {
  keyShareEvent,
  keyShareEvents,
  lockVenue,
} from "#/features/venue-requests/venue-lock.server";
import type { LockedEvent } from "#/features/venue-requests/venue-lock.server";
import {
  CLOSED_STATUSES,
  suspendedPieceWhere,
} from "#/features/venues/blocked-arrangements.server";
import {
  nextCivilDate,
  normalizeDatabaseTimestamp,
  openingPeriods,
  projectAvailability,
  toLocalMinuteValue,
} from "#/features/venues/availability";
import type {
  AvailabilityRecord,
  OccupiedPeriod,
  VenueBufferConflict,
} from "#/features/venues/availability";
import {
  DUPLICATE_NAME_MESSAGE,
  LAYOUT_LABELS,
  SEARCHABLE_EVENT_STATUSES,
  VENUE_BLOCK_RETRY_MESSAGE,
  crossesMidnight,
  parseAvailabilityRequest,
  parseLayouts,
  parseVenueId,
  parseVenueInput,
  parseVenueSearchRequest,
} from "#/features/venues/schema";
import type { OperatingHours, VenueLayout, VenueSearch } from "#/features/venues/schema";
import type { VenueWithConflicts } from "#/features/venues/server-fns";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * Keep this module server-only. A static `#/db/schema` import from a client-reachable module
 * would ship the full database schema to the browser. `server-fns.ts` imports this module
 * dynamically inside `.handler()`.
 *
 * These functions only access the database. Middleware checks the session and `venue` permission
 * before a server function calls them.
 */

type Database = typeof Db;
export type Venue = typeof venues.$inferSelect;
export type BufferedVenue = Pick<Venue, "id" | "setupMinutes" | "turnaroundMinutes">;

const log = logger.getChild("venues");

interface VenueSuitabilityCandidate {
  location: string;
  maxCapacity: number;
  facilities: readonly string[];
  accessibilityFeatures: readonly string[];
  supportedLayouts: readonly VenueLayout[];
  operatingHours: OperatingHours;
}

function normalise(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

/** Remove these words from both sides so "Sound and lighting" matches "lighting sound". */
const TAG_STOPWORDS = new Set(["and", "or", "the", "with", "plus", "for", "of"]);

function tagWords(value: string) {
  return normalise(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word !== "" && !TAG_STOPWORDS.has(word));
}

/**
 * Return requested phrases that the venue's stored tags do not cover. Split phrases on commas and
 * the word "and". Keep each phrase as the Coordinator typed it. A phrase matches when every word
 * occurs in a stored tag. Word order does not matter, and extra tag words are allowed. Treat
 * punctuation as a separator.
 *
 * ponytail: exact word-set matching with no synonyms. "PA system" does not match a stored "Sound and
 * lighting system". Add a synonym table (or embeddings) if cross-vocabulary recall matters.
 */
function missingTagPhrases(actual: readonly string[], requested: string | undefined): string[] {
  if (!requested) return [];
  const available = new Set(actual.flatMap(tagWords));
  return requested
    .split(/,|\band\b/iu)
    .map(phrase => phrase.trim())
    .filter(phrase => tagWords(phrase).some(word => !available.has(word)));
}

/**
 * PTR-30 criterion 5: the name of a failed criterion. Tests and later grouping use `criterion`;
 * the Coordinator reads `message`.
 */
export type SuitabilityCriterion =
  | "capacity"
  | "location"
  | "layout"
  | "accessibility"
  | "facilities"
  | "availability"
  | "booking"
  | "hold";

export interface SuitabilityFailure {
  criterion: SuitabilityCriterion;
  message: string;
}

/** Evaluate every rule so an unsuitable venue lists all failures. */
export interface SuitabilityVerdict {
  suitable: boolean;
  failures: SuitabilityFailure[];
}

function overlaps(
  period: { visibleStart: string; visibleEnd: string },
  start: string,
  end: string
) {
  return period.visibleStart < end && period.visibleEnd > start;
}

function clashingFailure(
  clashes: readonly OccupiedPeriod[],
  day: string
): SuitabilityFailure | null {
  const booked = clashes.find(period => period.state === "confirmed");
  if (booked) {
    return { criterion: "booking", message: `Booked for ${booked.label} on ${day}` };
  }
  const held = clashes.find(period => period.state === "tentative_hold");
  if (held) {
    return { criterion: "hold", message: `Tentatively held on ${day}` };
  }
  return null;
}

/**
 * Report whether the venue can host the requested window and why it cannot. Reasons are closure,
 * recorded unavailability, or an overlapping approved booking (criterion 4). Name a booking
 * before a block on the same day because the Coordinator needs that answer first.
 */
function availabilityFailure(
  venue: Pick<VenueSuitabilityCandidate, "operatingHours">,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[],
  bookings: readonly AvailabilityRecord[],
  holds: readonly AvailabilityRecord[]
): SuitabilityFailure | null {
  if (!filters.date) return null;

  const endDate = filters.endDate ?? filters.date;
  const range = {
    startsAt: `${filters.date}T00:00:00`,
    endsAt: `${nextCivilDate(endDate)}T00:00:00`,
  };
  const projection = projectAvailability(range, {
    bookings,
    blocks,
    holds,
    openPeriods: openingPeriods(filters.date, endDate, venue.operatingHours),
  });

  // Without times, each requested day needs some open time. A closed, blocked, or fully booked day
  // makes the range unavailable, even if other days are free.
  if (!filters.startTime || !filters.endTime) {
    for (let day = filters.date; day <= endDate; day = nextCivilDate(day)) {
      const dayStart = `${day}T00:00:00`;
      const dayEnd = `${nextCivilDate(day)}T00:00:00`;
      const free = projection.available.some(
        period => period.startsAt < dayEnd && period.endsAt > dayStart
      );
      if (free) continue;
      // Name a booking only if it overlaps the venue's opening hours. A booking outside those
      // hours, or on a closed day, did not make the day unavailable.
      const opening = openingPeriods(day, day, venue.operatingHours);
      const openClashes = projection.occupied.filter(period =>
        opening.some(open => overlaps(period, open.startsAt, open.endsAt))
      );
      const failure = clashingFailure(openClashes, day);
      if (failure) return failure;
      return { criterion: "availability", message: `Closed or unavailable on ${day}` };
    }
    return null;
  }

  // Treat the times as a daily hosting window, not one continuous period. A multi-day search must
  // cover each day, and a window past midnight does not fit any civil day.
  if (crossesMidnight(filters)) {
    return { criterion: "availability", message: "The requested window crosses midnight" };
  }

  for (let day = filters.date; day <= endDate; day = nextCivilDate(day)) {
    const requestedStart = `${day}T${filters.startTime}:00`;
    const requestedEnd = `${day}T${filters.endTime}:00`;
    const covered = projection.available.some(
      period => period.startsAt <= requestedStart && period.endsAt >= requestedEnd
    );
    if (covered) continue;

    // Check bookings first. The periods are sorted by start, but the Coordinator needs a booking
    // result first even when a block starts earlier that day.
    const clashes = projection.occupied.filter(period =>
      overlaps(period, requestedStart, requestedEnd)
    );
    const failure = clashingFailure(clashes, day);
    if (failure) return failure;
    if (clashes[0]) {
      return { criterion: "availability", message: `Unavailable on ${day}: ${clashes[0].label}` };
    }
    return {
      criterion: "availability",
      message: `Not open ${filters.startTime}–${filters.endTime} on ${day}`,
    };
  }
  return null;
}

/** The session requirements that a venue must meet. Search filters and venue requests carry them. */
export type VenueRequirements = Pick<
  VenueSearch,
  "expectedAttendance" | "capacity" | "layout" | "accessibility" | "facilities"
>;

/**
 * PTR-30 and PTR-138 AC1: name every requirement that the venue does not meet: capacity, layout,
 * accessibility, and facilities. Search and the request writers share this one rule, so a venue
 * that search calls suitable passes creation for the same requirements. Location is a search
 * filter only. Request approval and amendment check availability with `windowAvailabilityFailure`.
 */
export function requirementFailures(
  venue: Pick<
    VenueSuitabilityCandidate,
    "maxCapacity" | "facilities" | "accessibilityFeatures" | "supportedLayouts"
  >,
  requirements: VenueRequirements
): SuitabilityFailure[] {
  const failures: SuitabilityFailure[] = [];

  // Both filters set minimum values, so the stricter value decides.
  const requiredCapacity = Math.max(
    requirements.expectedAttendance ?? 0,
    requirements.capacity ?? 0
  );
  if (requiredCapacity > venue.maxCapacity) {
    failures.push({
      criterion: "capacity",
      message: `Holds ${venue.maxCapacity}; ${requiredCapacity} needed`,
    });
  }
  if (requirements.layout) {
    const requested = parseLayouts(requirements.layout);
    if (!requested.some(layout => venue.supportedLayouts.includes(layout))) {
      // An event's free-text preference skips the search form's guard and may name no known
      // layout. The message then names the requested preference.
      const wanted =
        requested.length > 0
          ? requested.map(layout => LAYOUT_LABELS[layout]).join(" or ")
          : requirements.layout;
      failures.push({ criterion: "layout", message: `Does not offer ${wanted}` });
    }
  }
  const missingAccessibility = missingTagPhrases(
    venue.accessibilityFeatures,
    requirements.accessibility
  );
  if (missingAccessibility.length > 0) {
    failures.push({
      criterion: "accessibility",
      message: `Missing accessibility: ${missingAccessibility.join(", ")}`,
    });
  }
  const missingFacilities = missingTagPhrases(venue.facilities, requirements.facilities);
  if (missingFacilities.length > 0) {
    failures.push({
      criterion: "facilities",
      message: `Missing facilities: ${missingFacilities.join(", ")}`,
    });
  }
  return failures;
}

/**
 * Apply the PTR-29 search filters and PTR-30 suitability rules in one function. A venue cannot
 * pass a filter and fail suitability on the same criterion (PTR-29 AC2). Check every filter and
 * name every failure (PTR-30 AC5), in this order: capacity, location, layout, accessibility,
 * facilities, availability. Search filters on `suitable`. The one caller is `handleSearchVenues`.
 */
export function evaluateVenueSuitability(
  venue: VenueSuitabilityCandidate,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[],
  bookings: readonly AvailabilityRecord[],
  holds: readonly AvailabilityRecord[] = []
): SuitabilityVerdict {
  const failures = requirementFailures(venue, filters);
  if (filters.location && !normalise(venue.location).includes(normalise(filters.location))) {
    // `requirementFailures` names capacity first. Location goes after it.
    const afterCapacity = failures[0]?.criterion === "capacity" ? 1 : 0;
    failures.splice(afterCapacity, 0, {
      criterion: "location",
      message: `Not in ${filters.location} (${venue.location})`,
    });
  }
  const availability = availabilityFailure(venue, filters, blocks, bookings, holds);
  if (availability) failures.push(availability);

  return { suitable: failures.length === 0, failures };
}

export async function handleListVenues(database: Database): Promise<Venue[]> {
  return database.select().from(venues).orderBy(asc(venues.name));
}

/**
 * The reject form's suggested-venue select needs only an id and a name. This reads fewer columns
 * than `handleListVenues`, which also selects `operatingHours`, a jsonb value the form does not
 * use. `defaultPreload: "intent"` runs this query on every queue-row hover, so the smaller select
 * avoids fetching unused columns.
 */
export async function handleListVenueOptions(
  database: Database
): Promise<{ id: number; name: string }[]> {
  return database
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .orderBy(asc(venues.name));
}

type VenueBlock = AvailabilityRecord & { venueId: number };

async function loadVenueBlocks(
  database: Pick<Database, "select">,
  venueIds: readonly number[],
  startsAt: string,
  endsAt: string
): Promise<VenueBlock[]> {
  if (venueIds.length === 0) return [];

  const rows = await database
    .select({
      id: venueUnavailability.id,
      venueId: venueUnavailability.venueId,
      startsAt: venueUnavailability.startsAt,
      endsAt: sql<string>`coalesce(${venueUnavailability.endsAt}, least(${endsAt}::timestamp, timestamp '9999-12-31 23:59:59'))::text`,
      reason: venueUnavailability.reason,
      openEnded: sql<boolean>`${venueUnavailability.endsAt} is null`,
    })
    .from(venueUnavailability)
    .where(
      and(
        inArray(venueUnavailability.venueId, venueIds),
        isNull(venueUnavailability.liftedAt),
        lt(venueUnavailability.startsAt, endsAt),
        or(isNull(venueUnavailability.endsAt), gt(venueUnavailability.endsAt, startsAt))
      )
    );

  return rows.map(row => {
    const block: VenueBlock = {
      id: String(row.id),
      venueId: row.venueId,
      startsAt: normalizeDatabaseTimestamp(row.startsAt),
      endsAt: normalizeDatabaseTimestamp(row.endsAt),
      label: row.reason || "Unavailable / blocked",
    };
    if (row.openEnded) block.openEnded = true;
    return block;
  });
}

/** One request window, in the database spelling `YYYY-MM-DD HH:MM:SS`, and its venue's hours. */
export interface RequestWindow {
  venueId: number;
  operatingHours: OperatingHours;
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-138 AC1: name why a venue cannot host one request window: it is not open then, or a
 * recorded block overlaps the window. Apply search's availability rule (`availabilityFailure`)
 * with no bookings or holds; the ledger checks those (ADR-7). Return null when the venue can host
 * the window. A request window covers part of one civil day.
 */
export function windowAvailabilityFailure(
  window: Pick<RequestWindow, "operatingHours" | "startsAt" | "endsAt">,
  blocks: readonly AvailabilityRecord[]
): SuitabilityFailure | null {
  const startsAt = toLocalMinuteValue(window.startsAt);
  const endsAt = toLocalMinuteValue(window.endsAt);
  return availabilityFailure(
    window,
    { date: startsAt.slice(0, 10), startTime: startsAt.slice(11), endTime: endsAt.slice(11) },
    blocks,
    [],
    []
  );
}

/**
 * Apply `windowAvailabilityFailure` to each window, in the order of `windows`. Read the blocks of
 * every window's venue in one query, never one read per window.
 */
export async function loadWindowAvailabilityFailures(
  database: Pick<Database, "select">,
  windows: readonly RequestWindow[]
): Promise<(SuitabilityFailure | null)[]> {
  if (windows.length === 0) return [];
  // Fixed-width timestamps sort as strings, so the earliest start and latest end bound the read.
  const startsAt = windows.reduce(
    (min, window) => (window.startsAt < min ? window.startsAt : min),
    windows[0].startsAt
  );
  const endsAt = windows.reduce(
    (max, window) => (window.endsAt > max ? window.endsAt : max),
    windows[0].endsAt
  );
  const venueIds = [...new Set(windows.map(window => window.venueId))];
  const blocksByVenue = Map.groupBy(
    await loadVenueBlocks(database, venueIds, startsAt, endsAt),
    block => block.venueId
  );
  return windows.map(window =>
    windowAvailabilityFailure(window, blocksByVenue.get(window.venueId) ?? [])
  );
}

export type VenueBooking = AvailabilityRecord & { venueId: number };

/**
 * Return approved bookings that overlap a range, grouped by venue (PTR-30 criterion 4). An
 * approved `venue_requests` row is the booking (PTR-36). Search and the availability calendar
 * both call this function. An integration test injects a loader into the search. Keep `label`
 * anonymous so the calendar and search do not reveal another event's name.
 */
export type VenueBookingLoader = (
  database: Pick<Database, "select">,
  venueIds: readonly number[],
  startsAt: string,
  endsAt: string
) => Promise<VenueBooking[]>;

export const loadVenueBookings: VenueBookingLoader = async (
  database,
  venueIds,
  startsAt,
  endsAt
) => {
  if (venueIds.length === 0) return [];

  const rows = await database
    .select({
      id: venueRequests.id,
      venueId: venueRequests.venueId,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
    })
    .from(venueRequests)
    .where(
      and(
        inArray(venueRequests.venueId, venueIds),
        eq(venueRequests.status, "approved"),
        // Use the same half-open overlap as the projection, without buffers. Periods that touch at
        // a boundary do not conflict.
        lt(venueRequests.startsAt, endsAt),
        gt(venueRequests.endsAt, startsAt)
      )
    )
    // Sort by start time so the result order is stable. The projection sorts the results again.
    .orderBy(asc(venueRequests.startsAt));

  return rows.map(row => ({
    id: row.id,
    venueId: row.venueId,
    startsAt: normalizeDatabaseTimestamp(row.startsAt),
    endsAt: normalizeDatabaseTimestamp(row.endsAt),
    label: "another event",
  }));
};

export type VenueHold = AvailabilityRecord & {
  venueId: number;
  eventId: number;
  heldById: string | null;
  assignedCoordinatorId: string | null;
  eventStatus: EventRequestStatus;
  expiresAt: string | null;
  warnAt: string | null;
};

/**
 * Return active tentative holds that overlap a range, grouped by venue (PTR-109). The calendar
 * and search show these holds as occupied. A returned `startsAt`/`endsAt` pair is the occupied
 * period: the requested times extended by the hold's stored buffers, clamped to years 0001 to
 * 9999 for display. The overlap filter compares the unclamped period. The event join reads
 * ownership and status, but the calendar sends only the actions that they allow the viewer.
 */
export async function loadVenueHolds(
  database: Pick<Database, "select">,
  venueIds: readonly number[],
  startsAt: string,
  endsAt: string
): Promise<VenueHold[]> {
  if (venueIds.length === 0) return [];

  // The hold's occupied period: its requested times extended by the buffers stored on the hold.
  // This reader uses the source table until PTR-135 moves it to `venue_occupancy`.
  const occupiedStart = sql`${venueHolds.startsAt} - make_interval(mins => ${venueHolds.setupMinutes})`;
  const occupiedEnd = sql`${venueHolds.endsAt} + make_interval(mins => ${venueHolds.turnaroundMinutes})`;

  const rows = await database
    .select({
      id: venueHolds.id,
      venueId: venueHolds.venueId,
      eventId: venueHolds.eventId,
      // Bound display timestamps to the calendar's civil years. Compare full extents below.
      startsAt: sql<string>`greatest(${occupiedStart}, timestamp '0001-01-01 00:00:00')::text`,
      endsAt: sql<string>`least(${occupiedEnd}, timestamp '9999-12-31 23:59:59')::text`,
      heldById: venueHolds.heldById,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
      eventStatus: eventRequests.status,
      expiresAt: venueHolds.expiresAt,
      warnAt: venueHolds.warnAt,
    })
    .from(venueHolds)
    .innerJoin(eventRequests, eq(venueHolds.eventId, eventRequests.id))
    .where(
      and(
        inArray(venueHolds.venueId, venueIds),
        eq(venueHolds.status, "held"),
        lt(occupiedStart, sql`${endsAt}::timestamp`),
        gt(occupiedEnd, sql`${startsAt}::timestamp`)
      )
    )
    .orderBy(asc(occupiedStart), asc(venueHolds.id));

  return rows.map(row => ({
    id: row.id,
    venueId: row.venueId,
    eventId: row.eventId,
    startsAt: normalizeDatabaseTimestamp(row.startsAt),
    endsAt: normalizeDatabaseTimestamp(row.endsAt),
    label: "tentative hold",
    heldById: row.heldById,
    assignedCoordinatorId: row.assignedCoordinatorId,
    eventStatus: row.eventStatus,
    expiresAt: row.expiresAt === null ? null : normalizeDatabaseTimestamp(row.expiresAt),
    warnAt: row.warnAt === null ? null : normalizeDatabaseTimestamp(row.warnAt),
  }));
}

/**
 * PTR-151: a hold request that overlaps a range, or every open request of some events. A
 * `requested` hold reserves no venue time, so no availability projection subtracts it. The
 * caller shows it with its ownership check and keeps the owner ids on the server.
 */
interface VenueHoldRequestRow {
  id: string;
  eventId: number;
  venueName: string;
  startsAt: string;
  endsAt: string;
  eventStatus: EventRequestStatus;
  heldById: string | null;
  assignedCoordinatorId: string | null;
}

/**
 * Read requested holds by event or by venue and range. Pass `eventIds` for the event's venue
 * section, or `venueId` and `range` for the calendar.
 */
export async function loadVenueHoldRequests(
  database: Pick<Database, "select">,
  filter:
    | { eventIds: readonly number[] }
    | { venueId: number; range: { startsAt: string; endsAt: string } }
): Promise<VenueHoldRequestRow[]> {
  const conditions = [eq(venueHolds.status, "requested")];
  if ("eventIds" in filter) {
    if (filter.eventIds.length === 0) return [];
    conditions.push(inArray(venueHolds.eventId, [...filter.eventIds]));
  } else {
    conditions.push(eq(venueHolds.venueId, filter.venueId));
    conditions.push(lt(venueHolds.startsAt, filter.range.endsAt));
    conditions.push(gt(venueHolds.endsAt, filter.range.startsAt));
  }

  const rows = await database
    .select({
      id: venueHolds.id,
      eventId: venueHolds.eventId,
      venueName: venues.name,
      startsAt: venueHolds.startsAt,
      endsAt: venueHolds.endsAt,
      eventStatus: eventRequests.status,
      heldById: venueHolds.heldById,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
    })
    .from(venueHolds)
    .innerJoin(eventRequests, eq(venueHolds.eventId, eventRequests.id))
    .innerJoin(venues, eq(venues.id, venueHolds.venueId))
    .where(and(...conditions))
    .orderBy(asc(venueHolds.startsAt), asc(venueHolds.id));

  return rows.map(row => ({
    id: row.id,
    eventId: row.eventId,
    venueName: row.venueName,
    startsAt: normalizeDatabaseTimestamp(row.startsAt),
    endsAt: normalizeDatabaseTimestamp(row.endsAt),
    eventStatus: row.eventStatus,
    heldById: row.heldById,
    assignedCoordinatorId: row.assignedCoordinatorId,
  }));
}

/**
 * PTR-138 AC1: the event's requirements under the session-requirement names. Every server reader
 * that turns an event's requirements into a session's selects these columns.
 */
export const eventRequirementColumns = {
  expectedAttendance: eventRequests.expectedAttendance,
  layout: eventRequests.roomLayoutPreference,
  accessibilityRequirements: eventRequests.accessibilityRequirements,
  requiredFacilities: eventRequests.venueRequirements,
};

/**
 * Read the caller's own event request through the venue gate. The event must belong to the asking
 * Coordinator and stand in `SEARCHABLE_EVENT_STATUSES`. The venue search that prefills the request
 * form, request creation, hold request and hold conversion use it. `null` is the refusal. Every
 * caller turns it into `AuthorizationError("Forbidden")`.
 */
export async function loadAssignedEvent(
  database: Pick<Database, "select">,
  eventId: number,
  coordinatorId: string
) {
  const rows = await database
    .select({
      id: eventRequests.id,
      name: eventRequests.eventName,
      proposedDates: eventRequests.proposedDates,
      requirements: eventRequirementColumns,
    })
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.id, eventId),
        inArray(eventRequests.status, [...SEARCHABLE_EVENT_STATUSES]),
        eq(eventRequests.assignedCoordinatorId, coordinatorId)
      )
    )
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Run PTR-29 venue search and PTR-30 suitability checks. Only the assigned Coordinator can supply
 * an event id; refuse other users without revealing whether the event exists. Use the event's
 * first complete proposed window and hard requirements as defaults. Evaluate explicit filters
 * once, then return suitable venues in `venues` and other venues in `unsuitable` with named
 * failures. This function does not write or reserve a venue (AC6).
 */
export async function handleSearchVenues(
  data: unknown,
  user: SessionUser,
  database: Database,
  loadBookings: VenueBookingLoader = loadVenueBookings
) {
  const { eventId, ...requested } = parseVenueSearchRequest(data);

  let event: { id: number; name: string } | null = null;
  let defaults: VenueSearch = {};

  if (eventId !== undefined) {
    // Refuse before the catalogue read. A forbidden event never pays for the venue list.
    const record = await loadAssignedEvent(database, eventId, user.id);
    if (!record) throw new AuthorizationError("Forbidden");
    event = { id: record.id, name: record.name };

    const timing = eventTiming(record.proposedDates);
    const { requirements } = record;
    defaults = {
      eventId,
      date: timing.eventDate ?? undefined,
      endDate: timing.endDate ?? undefined,
      startTime: timing.startTime ?? undefined,
      endTime: timing.endTime ?? undefined,
      expectedAttendance: requirements.expectedAttendance ?? undefined,
      layout: requirements.layout || undefined,
      accessibility: requirements.accessibilityRequirements || undefined,
      facilities: requirements.requiredFacilities || undefined,
    };
  }

  // A hand-edited or SSR URL can set a key to `undefined`. Do not spread it over the event default.
  // Keep only supplied values.
  const suppliedValues: Record<string, unknown> = requested;
  const supplied = Object.fromEntries(
    Object.entries(suppliedValues).filter(([, value]) => value !== undefined)
  ) as Partial<VenueSearch>;
  const filters: VenueSearch = { ...defaults, ...supplied };
  // The suitability verdict stays in JS (`evaluateVenueSuitability` below): a SQL pre-filter
  // would drop the failure reasons the unsuitable list must name.
  const venueRows = await handleListVenues(database);
  let blocksByVenue = new Map<number, VenueBlock[]>();
  let bookingsByVenue = new Map<number, VenueBooking[]>();
  let holdsByVenue = new Map<number, VenueHold[]>();

  if (filters.date && venueRows.length > 0) {
    const startsAt = `${filters.date} 00:00:00`;
    const endsAt = `${nextCivilDate(filters.endDate ?? filters.date)} 00:00:00`;
    const venueIds = venueRows.map(venue => venue.id);
    const [blocks, bookings, holds] = await Promise.all([
      loadVenueBlocks(database, venueIds, startsAt, endsAt),
      loadBookings(database, venueIds, startsAt, endsAt),
      loadVenueHolds(database, venueIds, startsAt, endsAt),
    ]);
    blocksByVenue = Map.groupBy(blocks, block => block.venueId);
    bookingsByVenue = Map.groupBy(bookings, booking => booking.venueId);
    holdsByVenue = Map.groupBy(holds, hold => hold.venueId);
  }

  const suitable: Venue[] = [];
  const unsuitable: { venue: Venue; failures: SuitabilityFailure[] }[] = [];
  for (const venue of venueRows) {
    const verdict = evaluateVenueSuitability(
      venue,
      filters,
      blocksByVenue.get(venue.id) ?? [],
      bookingsByVenue.get(venue.id) ?? [],
      holdsByVenue.get(venue.id) ?? []
    );
    if (verdict.suitable) suitable.push(venue);
    else unsuitable.push({ venue, failures: verdict.failures });
  }

  return { event, filters, venues: suitable, unsuitable };
}

interface VenueBufferConflictRow {
  id: number;
  venueRequestId: string | null;
  venueHoldId: string | null;
  eventId: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  eventName: string;
}

export function mapConflictRowsToConflicts(
  rows: readonly VenueBufferConflictRow[]
): VenueBufferConflict[] {
  return rows.map(row => {
    const kind: VenueBufferConflict["kind"] = !row.active
      ? "suspended"
      : row.venueRequestId !== null
        ? "booking"
        : "hold";
    return {
      id: row.venueRequestId ?? row.venueHoldId ?? String(row.id),
      kind,
      eventId: row.eventId,
      eventName: row.eventName,
      startsAt: row.startsAt,
      endsAt: row.endsAt ?? row.startsAt,
    };
  });
}

function effectiveBuffer(
  existingOrCandidate: {
    startsAt: unknown;
    endsAt: unknown;
    venueRequestId: unknown;
    venueHoldId: unknown;
  },
  req: { startsAt: unknown; endsAt: unknown },
  hold: { startsAt: unknown; endsAt: unknown },
  minutes: number
) {
  return sql`case
    when (${existingOrCandidate.venueRequestId} is not null and (${existingOrCandidate.startsAt} <> ${req.startsAt} or ${existingOrCandidate.endsAt} <> ${req.endsAt}))
      or (${existingOrCandidate.venueHoldId} is not null and (${existingOrCandidate.startsAt} <> ${hold.startsAt} or ${existingOrCandidate.endsAt} <> ${hold.endsAt}))
    then 0
    else ${minutes}
  end`;
}

/**
 * PTR-132: Load conflicting venue occupancy rows created by a buffer change.
 * Each ledger row retests using its own stored buffers (split piece has absolute extent with 0/0 buffers);
 * only newly created overlaps between different commitment sources are returned.
 */
export async function loadVenueBufferConflictRows(
  database: Pick<Database, "select">,
  venue: BufferedVenue
): Promise<VenueBufferConflictRow[]> {
  if (venue.setupMinutes === 0 && venue.turnaroundMinutes === 0) return [];

  const candidate = alias(venueOccupancy, "candidate");
  const existingRequest = alias(venueRequests, "existing_request");
  const existingHold = alias(venueHolds, "existing_hold");
  const candidateRequest = alias(venueRequests, "candidate_request");
  const candidateHold = alias(venueHolds, "candidate_hold");

  const existingNewSetup = effectiveBuffer(
    venueOccupancy,
    existingRequest,
    existingHold,
    venue.setupMinutes
  );
  const existingNewTurnaround = effectiveBuffer(
    venueOccupancy,
    existingRequest,
    existingHold,
    venue.turnaroundMinutes
  );
  const candidateNewSetup = effectiveBuffer(
    candidate,
    candidateRequest,
    candidateHold,
    venue.setupMinutes
  );
  const candidateNewTurnaround = effectiveBuffer(
    candidate,
    candidateRequest,
    candidateHold,
    venue.turnaroundMinutes
  );

  const existingNewRange = sql`tsrange(${venueOccupancy.startsAt} - make_interval(mins => (${existingNewSetup})::integer), ${venueOccupancy.endsAt} + make_interval(mins => (${existingNewTurnaround})::integer), '[)')`;
  const candidateNewRange = sql`tsrange(${candidate.startsAt} - make_interval(mins => (${candidateNewSetup})::integer), ${candidate.endsAt} + make_interval(mins => (${candidateNewTurnaround})::integer), '[)')`;

  const storedOverlap = overlapsPeriod({
    venueId: venue.id,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    setupMinutes: candidate.setupMinutes,
    turnaroundMinutes: candidate.turnaroundMinutes,
  });

  // A new range extends a row by at most the new setup on the left and the new turnaround on the
  // right, so this wider condition is necessary for any new overlap. Split pieces carry 0 buffers,
  // which is conservative. The condition keeps PostgreSQL from building every ordered pair.
  // Multiply in double precision: the two int4 columns can sum past int4, and `make_interval`
  // would reject the parameter.
  const maxBuffer = venue.setupMinutes + venue.turnaroundMinutes;
  const maxBufferInterval = sql`(${maxBuffer})::double precision * interval '1 minute'`;
  const pairs = await database
    .select({
      existingId: venueOccupancy.id,
      candidateId: candidate.id,
    })
    .from(venueOccupancy)
    .innerJoin(
      candidate,
      and(
        eq(candidate.venueId, venueOccupancy.venueId),
        lt(venueOccupancy.id, candidate.id),
        isNull(candidate.venueUnavailabilityId),
        sql`coalesce(${venueOccupancy.venueRequestId} <> ${candidate.venueRequestId}, true)`,
        sql`coalesce(${venueOccupancy.venueHoldId} <> ${candidate.venueHoldId}, true)`,
        sql`${candidate.startsAt} < ${venueOccupancy.endsAt} + ${maxBufferInterval}`,
        sql`${candidate.endsAt} > ${venueOccupancy.startsAt} - ${maxBufferInterval}`
      )
    )
    .leftJoin(existingRequest, eq(existingRequest.id, venueOccupancy.venueRequestId))
    .leftJoin(existingHold, eq(existingHold.id, venueOccupancy.venueHoldId))
    .leftJoin(candidateRequest, eq(candidateRequest.id, candidate.venueRequestId))
    .leftJoin(candidateHold, eq(candidateHold.id, candidate.venueHoldId))
    .where(
      and(
        eq(venueOccupancy.venueId, venue.id),
        or(
          and(eq(venueOccupancy.active, true), isNull(venueOccupancy.venueUnavailabilityId)),
          suspendedPieceWhere()
        ),
        sql`${existingNewRange} && ${candidateNewRange} and not (${storedOverlap})`
      )
    );

  if (pairs.length === 0) return [];

  const conflictIds = new Set<number>();
  for (const pair of pairs) {
    conflictIds.add(pair.existingId);
    conflictIds.add(pair.candidateId);
  }

  // Drop only a closed row, never its pair: a cancelled event keeps its commitment, and a live
  // commitment that newly overlaps it is still flagged.
  return database
    .select({
      id: venueOccupancy.id,
      venueRequestId: venueOccupancy.venueRequestId,
      venueHoldId: venueOccupancy.venueHoldId,
      eventId: eventRequests.id,
      startsAt: venueOccupancy.startsAt,
      endsAt: venueOccupancy.endsAt,
      active: venueOccupancy.active,
      eventName: eventRequests.eventName,
    })
    .from(venueOccupancy)
    .innerJoin(
      eventRequests,
      and(
        eq(eventRequests.id, venueOccupancy.eventId),
        notInArray(eventRequests.status, [...CLOSED_STATUSES])
      )
    )
    .where(inArray(venueOccupancy.id, [...conflictIds]))
    .orderBy(asc(venueOccupancy.startsAt), asc(venueOccupancy.id));
}

/**
 * PTR-132: Return commitments that newly conflict under a venue's buffer settings.
 */
export async function loadVenueBufferConflicts(
  database: Pick<Database, "select">,
  venue: BufferedVenue
): Promise<VenueBufferConflict[]> {
  const rows = await loadVenueBufferConflictRows(database, venue);
  return mapConflictRowsToConflicts(rows);
}

/**
 * Read one venue. `bufferConflicts` names other events, so return the conflicts only when the
 * caller can act on them (`venue:update`).
 */
export async function handleGetVenue(
  data: unknown,
  database: Database,
  options: { includeConflicts?: boolean } = {}
): Promise<VenueWithConflicts | null> {
  const { id } = parseVenueId(data);
  const rows = await database.select().from(venues).where(eq(venues.id, id));
  const row = rows.at(0);
  if (!row) return null;
  if (!options.includeConflicts) return row;
  const bufferConflicts = await loadVenueBufferConflicts(database, row);
  return { ...row, bufferConflicts };
}

/**
 * Return a venue's availability over an inclusive date range (PTR-28). Include its opening
 * periods, minus recorded unavailability and approved bookings that overlap the range. Use
 * floating venue-local timestamps. Approved bookings appear as "confirmed" periods (PTR-36).
 * Include active tentative holds (PTR-109).
 */
export async function handleGetVenueAvailability(
  data: unknown,
  viewerId: string,
  database: Database
) {
  const selection = parseAvailabilityRequest(data);

  const venueRows = await database
    .select({
      id: venues.id,
      name: venues.name,
      setupMinutes: venues.setupMinutes,
      turnaroundMinutes: venues.turnaroundMinutes,
      operatingHours: venues.operatingHours,
    })
    .from(venues)
    .where(eq(venues.id, selection.venueId))
    .limit(1);
  const venue = venueRows.at(0);
  // Return `null` for a missing row, as `handleGetVenue` does. The route uses the router's
  // `notFound()` boundary for a mistyped id. `handleSaveVenue` returns 404 because a missing row
  // makes the write fail.
  if (!venue) return null;

  const startsAt = `${selection.startDate}T00:00:00`;
  const endsAt = `${nextCivilDate(selection.endDate)}T00:00:00`;
  const databaseStartsAt = startsAt.replace("T", " ");
  const databaseEndsAt = endsAt.replace("T", " ");
  const [blocks, bookings, holds, requestedHolds, conflictRows] = await Promise.all([
    loadVenueBlocks(database, [venue.id], databaseStartsAt, databaseEndsAt),
    loadVenueBookings(database, [venue.id], databaseStartsAt, databaseEndsAt),
    loadVenueHolds(database, [venue.id], databaseStartsAt, databaseEndsAt),
    loadVenueHoldRequests(database, {
      venueId: venue.id,
      range: { startsAt: databaseStartsAt, endsAt: databaseEndsAt },
    }),
    loadVenueBufferConflictRows(database, venue),
  ]);

  const conflictRequestIds = new Set(
    conflictRows.map(r => r.venueRequestId).filter((id): id is string => id !== null)
  );
  const conflictHoldIds = new Set(
    conflictRows.map(r => r.venueHoldId).filter((id): id is string => id !== null)
  );

  // Copy rows before adding conflict flags. The loader shares these rows with other callers.
  // oxlint-disable-next-line oxc/no-map-spread
  const markedBookings = bookings.map(b => ({
    ...b,
    ...(conflictRequestIds.has(b.id) ? { bufferConflict: true } : {}),
  }));

  // Keep the owner ids on the server, so Venue Staff cannot learn who owns another user's hold. A
  // hold that the viewer can convert (`canConvertHold`) carries `convertDefaults`: the event's
  // requirements, which the conversion form starts from (PTR-138 AC1).
  const convertibleEventIds = [
    ...new Set(holds.filter(hold => canConvertHold(hold, viewerId)).map(hold => hold.eventId)),
  ];
  const convertDefaults = new Map(
    convertibleEventIds.length === 0
      ? []
      : (
          await database
            .select({ id: eventRequests.id, requirements: eventRequirementColumns })
            .from(eventRequests)
            .where(inArray(eventRequests.id, convertibleEventIds))
        ).map(row => [row.id, row.requirements])
  );
  // Copy rows before adding viewer flags. The loader shares these rows with other callers.
  // oxlint-disable-next-line oxc/no-map-spread
  const manageableHolds = holds.map(hold => {
    // The warning belongs to the Coordinator, so only the assignee reads it (PTR-142 AC3).
    const isAssignee = viewerId !== "" && hold.assignedCoordinatorId === viewerId;
    // A cancelled event keeps its hold, but its expiry and warning cannot change.
    const canChangeHold = hold.eventStatus !== "cancelled";
    return {
      ...hold,
      canRelease: canReleaseHold(hold, viewerId),
      convertDefaults: convertDefaults.get(hold.eventId),
      warnAt: isAssignee ? hold.warnAt : null,
      canChangeHold,
      canSetWarning: isAssignee && canChangeHold && hold.expiresAt !== null,
      ...(conflictHoldIds.has(hold.id) ? { bufferConflict: true } : {}),
    };
  });

  return {
    venue: { id: venue.id, name: venue.name },
    startDate: selection.startDate,
    endDate: selection.endDate,
    // PTR-151: a requested hold shows on the calendar but reserves no time, so it stays out of
    // `projectAvailability`. Show a request on a searchable event to every reader, as the queue
    // does. A request whose event left the statuses stays visible to its owner, so it can still be
    // withdrawn.
    requestedHolds: requestedHolds
      .filter(
        hold =>
          SEARCHABLE_EVENT_STATUSES.includes(hold.eventStatus) || canReleaseHold(hold, viewerId)
      )
      .map(hold => ({
        id: hold.id,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        canWithdraw: canReleaseHold(hold, viewerId),
      })),
    ...projectAvailability(
      { startsAt, endsAt },
      {
        // Read the same approved bookings and holds as the search (PTR-36, PTR-109).
        bookings: markedBookings,
        blocks,
        holds: manageableHolds,
        openPeriods: openingPeriods(selection.startDate, selection.endDate, venue.operatingHours),
      }
    ),
  };
}

/**
 * Postgres reports a unique violation as a driver error, and Drizzle wraps that error.
 * `isConstraintViolation` reads the constraint name from the wrapped error. Convert the violation
 * to the sentence the form shows. A duplicate name is the one conflict the UI can cause by itself.
 */
function rethrowReadable(error: unknown): never {
  if (isConstraintViolation(error, "venues_name_unique")) {
    throw new Error(DUPLICATE_NAME_MESSAGE, { cause: error });
  }
  throw error;
}

/**
 * Create a venue when `data` has no `id`. Replace the full row when `data` has an `id`
 * (PTR-26 criterion 1). Middleware checks `venue:create` or `venue:update` from `data.id` before
 * `.validator(parseVenueInput)` runs. Return 404 below for a missing row. `actorId` is the acting
 * user, recorded in `venue_buffer_changes.changed_by_id`.
 */
export async function handleSaveVenue(
  data: unknown,
  database: Database,
  actorId: string
): Promise<VenueWithConflicts> {
  const { id, ...fields } = parseVenueInput(data);

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- retry loop on concurrent deadlock
      return await database.transaction(async tx => {
        if (id === undefined) {
          const [saved] = await tx.insert(venues).values(fields).returning().catch(rethrowReadable);
          if (saved.setupMinutes !== 0 || saved.turnaroundMinutes !== 0) {
            await tx.insert(venueBufferChanges).values({
              venueId: saved.id,
              previousSetupMinutes: 0,
              previousTurnaroundMinutes: 0,
              setupMinutes: saved.setupMinutes,
              turnaroundMinutes: saved.turnaroundMinutes,
              changedById: actorId,
            });
          }
          return { ...saved, bufferConflicts: [] };
        }

        // Key-share existing events before locking the venue so lock order stays event -> venue.
        const existingOccupancies = await tx
          .selectDistinct({ eventId: venueOccupancy.eventId })
          .from(venueOccupancy)
          .where(and(eq(venueOccupancy.venueId, id), isNull(venueOccupancy.venueUnavailabilityId)));

        const preLockEventIds = existingOccupancies
          .map(r => r.eventId)
          .filter((eid): eid is number => eid !== null)
          .toSorted((a, b) => a - b);

        const lockedEvents = new Map<number, LockedEvent>(
          (await keyShareEvents(tx, preLockEventIds)).map(locked => [locked.id, locked] as const)
        );

        await lockVenue(tx, id);

        const previousRows = await tx
          .select({
            setupMinutes: venues.setupMinutes,
            turnaroundMinutes: venues.turnaroundMinutes,
          })
          .from(venues)
          .where(eq(venues.id, id));
        const previous = previousRows.at(0);
        if (!previous) throw new NotFoundError("Not Found");
        const previousSetupMinutes = previous.setupMinutes;
        const previousTurnaroundMinutes = previous.turnaroundMinutes;

        const [saved] = await tx
          .update(venues)
          .set(fields)
          .where(eq(venues.id, id))
          .returning()
          .catch(rethrowReadable);

        if (
          previousSetupMinutes !== saved.setupMinutes ||
          previousTurnaroundMinutes !== saved.turnaroundMinutes
        ) {
          await tx.insert(venueBufferChanges).values({
            venueId: saved.id,
            previousSetupMinutes,
            previousTurnaroundMinutes,
            setupMinutes: saved.setupMinutes,
            turnaroundMinutes: saved.turnaroundMinutes,
            changedById: actorId,
          });

          const conflictRows = await loadVenueBufferConflictRows(tx, saved);
          for (const row of conflictRows) {
            if (!lockedEvents.has(row.eventId)) {
              // oxlint-disable-next-line eslint/no-await-in-loop -- key-share remaining event
              const locked = await keyShareEvent(tx, row.eventId);
              if (locked) lockedEvents.set(locked.id, locked);
            }
          }

          // An event flagged under the previous buffers was already notified. Notify only a newly
          // flagged event, so each buffer edit does not repeat the same notice.
          const previouslyFlagged = new Set(
            (
              await loadVenueBufferConflictRows(tx, {
                id: saved.id,
                setupMinutes: previousSetupMinutes,
                turnaroundMinutes: previousTurnaroundMinutes,
              })
            ).map(row => row.eventId)
          );

          const activeConflictRows = conflictRows.filter(row => {
            const locked = lockedEvents.get(row.eventId);
            return Boolean(locked && !CLOSED_STATUSES.some(status => status === locked.status));
          });

          const rowsByEvent = Map.groupBy(activeConflictRows, row => row.eventId);
          const notices: NewNotification[] = [];
          for (const [eventId, rows] of rowsByEvent) {
            if (previouslyFlagged.has(eventId)) continue;
            const locked = lockedEvents.get(eventId);
            if (!locked) continue;
            if (!locked.assignedCoordinatorId) {
              log.warn("No Coordinator to notify of the venue buffer conflict", { eventId });
              continue;
            }
            const firstRow = rows[0];
            const safeEventName =
              (locked.eventName || firstRow.eventName || "Untitled event").trim() ||
              "Untitled event";

            const payload: NotificationPayloads["venue_buffer_conflict"] = {
              eventName: safeEventName,
              venueId: saved.id,
              venueName: saved.name,
              startsAt: firstRow.startsAt,
              endsAt: firstRow.endsAt ?? firstRow.startsAt,
              setupMinutes: saved.setupMinutes,
              turnaroundMinutes: saved.turnaroundMinutes,
              ...(rows.length > 1
                ? {
                    periods: rows.map(r => ({
                      startsAt: r.startsAt,
                      endsAt: r.endsAt ?? r.startsAt,
                    })),
                  }
                : {}),
            };

            notices.push({
              recipientId: locked.assignedCoordinatorId,
              eventRequestId: locked.id,
              kind: "venue_buffer_conflict",
              payload,
            });
          }

          if (notices.length > 0) {
            await raiseNotifications(tx, notices);
          }

          return {
            ...saved,
            bufferConflicts: mapConflictRowsToConflicts(activeConflictRows),
          };
        }

        const bufferConflicts = await loadVenueBufferConflicts(tx, saved);
        return { ...saved, bufferConflicts };
      });
    } catch (error) {
      if (isDeadlock(error) && attempt < 2) {
        log.warn("Retrying venue buffer save that deadlocked", { attempt, sqlstate: "40P01" });
        continue;
      }
      throw error;
    }
  }

  throw new ConflictError(VENUE_BLOCK_RETRY_MESSAGE);
}
