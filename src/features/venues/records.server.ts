import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  eventRequests,
  venueBufferChanges,
  venueHolds,
  venueRequests,
  venueUnavailability,
  venues,
} from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { AuthorizationError, NotFoundError } from "#/features/auth/session";
import { eventTiming } from "#/features/events/access";
import { loadAssignedEvent } from "#/features/events/records.server";
import { canConvertHold, canReleaseHold } from "#/features/venue-requests/holds";
import { holdOccupancy } from "#/features/venue-requests/hold-occupancy.server";
import { lockVenue } from "#/features/venue-requests/venue-lock.server";
import {
  nextCivilDate,
  normalizeDatabaseTimestamp,
  openingPeriods,
  projectAvailability,
} from "#/features/venues/availability";
import type { AvailabilityRecord, OccupiedPeriod } from "#/features/venues/availability";
import {
  DUPLICATE_NAME_MESSAGE,
  LAYOUT_LABELS,
  SEARCHABLE_EVENT_STATUSES,
  crossesMidnight,
  parseAvailabilityRequest,
  parseLayouts,
  parseVenueId,
  parseVenueInput,
  parseVenueSearchRequest,
} from "#/features/venues/schema";
import type { OperatingHours, VenueLayout, VenueSearch } from "#/features/venues/schema";
import { isConstraintViolation } from "#/lib/db-errors";

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
  venue: VenueSuitabilityCandidate,
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

/**
 * Apply the PTR-29 search filters and PTR-30 suitability rules in one function. A venue cannot
 * pass a filter and fail suitability on the same criterion (PTR-29 AC2). Check every filter and
 * name every failure (PTR-30 AC5). Search filters on `suitable`. This function has one caller:
 * `handleSearchVenues`.
 */
export function evaluateVenueSuitability(
  venue: VenueSuitabilityCandidate,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[],
  bookings: readonly AvailabilityRecord[],
  holds: readonly AvailabilityRecord[] = []
): SuitabilityVerdict {
  const failures: SuitabilityFailure[] = [];

  // Both filters set minimum values, so the stricter value decides.
  const requiredCapacity = Math.max(filters.expectedAttendance ?? 0, filters.capacity ?? 0);
  if (requiredCapacity > venue.maxCapacity) {
    failures.push({
      criterion: "capacity",
      message: `Holds ${venue.maxCapacity}; ${requiredCapacity} needed`,
    });
  }
  if (filters.location && !normalise(venue.location).includes(normalise(filters.location))) {
    failures.push({
      criterion: "location",
      message: `Not in ${filters.location} (${venue.location})`,
    });
  }
  if (filters.layout) {
    const requested = parseLayouts(filters.layout);
    if (!requested.some(layout => venue.supportedLayouts.includes(layout))) {
      // An event's free-text preference skips the search form's guard and may name no known
      // layout. The message then names the requested preference.
      const wanted =
        requested.length > 0
          ? requested.map(layout => LAYOUT_LABELS[layout]).join(" or ")
          : filters.layout;
      failures.push({ criterion: "layout", message: `Does not offer ${wanted}` });
    }
  }
  const missingAccessibility = missingTagPhrases(
    venue.accessibilityFeatures,
    filters.accessibility
  );
  if (missingAccessibility.length > 0) {
    failures.push({
      criterion: "accessibility",
      message: `Missing accessibility: ${missingAccessibility.join(", ")}`,
    });
  }
  const missingFacilities = missingTagPhrases(venue.facilities, filters.facilities);
  if (missingFacilities.length > 0) {
    failures.push({
      criterion: "facilities",
      message: `Missing facilities: ${missingFacilities.join(", ")}`,
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
  database: Database,
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
      endsAt: venueUnavailability.endsAt,
      reason: venueUnavailability.reason,
    })
    .from(venueUnavailability)
    .where(
      and(
        inArray(venueUnavailability.venueId, venueIds),
        lt(venueUnavailability.startsAt, endsAt),
        gt(venueUnavailability.endsAt, startsAt)
      )
    );

  return rows.map(row => ({
    id: String(row.id),
    venueId: row.venueId,
    startsAt: normalizeDatabaseTimestamp(row.startsAt),
    endsAt: normalizeDatabaseTimestamp(row.endsAt),
    label: row.reason || "Unavailable / blocked",
  }));
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
  eventStatus: string;
};

/**
 * Return active tentative holds that overlap a range, grouped by venue (PTR-109). The calendar
 * and search show these holds as occupied. A returned `startsAt`/`endsAt` pair is the occupied
 * period: the requested times extended by the hold's stored buffers, clamped to years 0001 to
 * 9999 for display. The overlap filter compares the unclamped period. The event join checks
 * ownership, but the result carries only the derived `canRelease` and `canConvert` values.
 */
export async function loadVenueHolds(
  database: Pick<Database, "select">,
  venueIds: readonly number[],
  startsAt: string,
  endsAt: string
): Promise<VenueHold[]> {
  if (venueIds.length === 0) return [];

  const { occupiedStart, occupiedEnd } = holdOccupancy();

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
  }));
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
    const assignedRecord = await loadAssignedEvent(
      database,
      eventId,
      user.id,
      SEARCHABLE_EVENT_STATUSES
    );
    if (!assignedRecord) throw new AuthorizationError("Forbidden");
    const record = assignedRecord;
    event = { id: record.id, name: record.name };

    const timing = eventTiming(record.proposedDates);
    defaults = {
      eventId,
      date: timing.eventDate ?? undefined,
      endDate: timing.endDate ?? undefined,
      startTime: timing.startTime ?? undefined,
      endTime: timing.endTime ?? undefined,
      expectedAttendance: record.expectedAttendance ?? undefined,
      layout: record.roomLayoutPreference || undefined,
      accessibility: record.accessibilityRequirements || undefined,
      facilities: record.venueRequirements || undefined,
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

export async function handleGetVenue(data: unknown, database: Database): Promise<Venue | null> {
  const { id } = parseVenueId(data);
  const rows = await database.select().from(venues).where(eq(venues.id, id));
  return rows.at(0) ?? null;
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
    .select({ id: venues.id, name: venues.name, operatingHours: venues.operatingHours })
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
  const [blocks, bookings, holds, pendingEventIds] = await Promise.all([
    loadVenueBlocks(database, [venue.id], databaseStartsAt, databaseEndsAt),
    loadVenueBookings(database, [venue.id], databaseStartsAt, databaseEndsAt),
    loadVenueHolds(database, [venue.id], databaseStartsAt, databaseEndsAt),
    // Conversion creates a pending request for the event and venue. If one already exists, the
    // unique index rejects conversion, so offer release only.
    database
      .select({ eventId: venueRequests.eventId })
      .from(venueRequests)
      .where(and(eq(venueRequests.venueId, venue.id), eq(venueRequests.status, "pending")))
      .then(rows => new Set(rows.map(row => row.eventId))),
  ]);

  // Ownership controls whether the calendar offers Release or Convert. Keep both ids on the
  // server; return only booleans so Venue Staff cannot learn who owns another user's hold.
  // Coordinators can release orphan holds to free a slot, but cannot convert them. Conversion
  // also requires a submitted event.
  // Copy rows before adding viewer flags. The loader shares these rows with other callers.
  // oxlint-disable-next-line oxc/no-map-spread
  const manageableHolds = holds.map(hold => {
    const canRelease = canReleaseHold(hold, viewerId);
    const canConvert = canConvertHold(hold, viewerId) && !pendingEventIds.has(hold.eventId);
    return {
      ...hold,
      canRelease,
      canConvert,
    };
  });

  return {
    venue: { id: venue.id, name: venue.name },
    startDate: selection.startDate,
    endDate: selection.endDate,
    ...projectAvailability(
      { startsAt, endsAt },
      {
        // Read the same approved bookings and holds as the search (PTR-36, PTR-109).
        bookings,
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
): Promise<Venue> {
  const { id, ...fields } = parseVenueInput(data);
  return database.transaction(async tx => {
    let previousSetupMinutes = 0;
    let previousTurnaroundMinutes = 0;
    let saved: Venue;
    if (id === undefined) {
      [saved] = await tx.insert(venues).values(fields).returning().catch(rethrowReadable);
    } else {
      // Take the hold writer's advisory lock first. It serializes every writer of the buffer
      // columns, so the read below is the current version.
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
      previousSetupMinutes = previous.setupMinutes;
      previousTurnaroundMinutes = previous.turnaroundMinutes;
      [saved] = await tx
        .update(venues)
        .set(fields)
        .where(eq(venues.id, id))
        .returning()
        .catch(rethrowReadable);
    }
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
    }
    return saved;
  });
}
