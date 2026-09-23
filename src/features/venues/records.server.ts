import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";

import type { db as Db } from "#/db";
import { venueRequests, venueUnavailability, venues } from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { AuthorizationError, NotFoundError } from "#/features/auth/session";
import { eventTiming } from "#/features/events/access";
import { loadAssignedEvent } from "#/features/events/records.server";
import {
  nextCivilDate,
  normalizeDatabaseTimestamp,
  openingPeriods,
  projectAvailability,
} from "#/features/venues/availability";
import type { AvailabilityRecord } from "#/features/venues/availability";
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
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach.
 * `server-fns.ts` reaches this through a dynamic `import()` inside `.handler()`.
 *
 * These are pure database operations: the server function's middleware pipeline has already
 * verified the session and the `venue` permission before any of them runs.
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

/** Dropped from both sides so "Sound and lighting" and "lighting sound" compare equal. */
const TAG_STOPWORDS = new Set(["and", "or", "the", "with", "plus", "for", "of"]);

function tagWords(value: string) {
  return normalise(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word !== "" && !TAG_STOPWORDS.has(word));
}

/**
 * The requested phrases — split on commas and the word "and" — that the venue's stored tags do
 * not cover, named as the Coordinator typed them. A phrase is covered when every one of its words
 * is some stored tag's word, in any order, so a stored tag with extra words still satisfies a
 * shorter request and punctuation is just a separator.
 *
 * ponytail: exact word-set matching, no synonyms — "PA system" does not match a stored "Sound and
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
 * PTR-30 criterion 5: the criterion a venue failed, named. `criterion` is stable for tests and
 * any later grouping; `message` is the sentence the Coordinator reads.
 */
export type SuitabilityCriterion =
  | "capacity"
  | "location"
  | "layout"
  | "accessibility"
  | "facilities"
  | "availability"
  | "booking";

export interface SuitabilityFailure {
  criterion: SuitabilityCriterion;
  message: string;
}

/** Every rule is evaluated, so an unsuitable venue lists everything wrong with it, not the first thing. */
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

/**
 * Whether the venue can host the requested window, and if not, why: closed, blocked by recorded
 * unavailability, or — criterion 4 — holding an approved booking that overlaps it. A booking is
 * named ahead of a block on the same day because it is the answer the Coordinator most needs.
 */
function availabilityFailure(
  venue: VenueSuitabilityCandidate,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[],
  bookings: readonly AvailabilityRecord[]
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
    openPeriods: openingPeriods(filters.date, endDate, venue.operatingHours),
  });
  // Without times the event needs some open time on each requested day, so a day that is closed,
  // blocked or booked right through fails the range however free the other days are.
  if (!filters.startTime || !filters.endTime) {
    for (let day = filters.date; day <= endDate; day = nextCivilDate(day)) {
      const dayStart = `${day}T00:00:00`;
      const dayEnd = `${nextCivilDate(day)}T00:00:00`;
      const free = projection.available.some(
        period => period.startsAt < dayEnd && period.endsAt > dayStart
      );
      if (free) continue;
      // Name a booking only when it takes some of the day's opening time; a booking outside the
      // hours, or on a closed day, is not what removed the day.
      const opening = openingPeriods(day, day, venue.operatingHours);
      const booked = projection.occupied.find(
        period =>
          period.state === "confirmed" &&
          opening.some(open => overlaps(period, open.startsAt, open.endsAt))
      );
      return booked
        ? { criterion: "booking", message: `Booked for ${booked.label} on ${day}` }
        : { criterion: "availability", message: `Closed or unavailable on ${day}` };
    }
    return null;
  }

  // The times are a daily hosting window, not one continuous period: a two-day search needs each
  // day covered on its own, and a window running past midnight fits no civil day at all.
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

    // Occupied periods are sorted by start, so look for a booking first: a booked venue is the
    // answer the Coordinator most needs, even when a block starts earlier the same day.
    const clashes = projection.occupied.filter(period =>
      overlaps(period, requestedStart, requestedEnd)
    );
    const booked = clashes.find(period => period.state === "confirmed");
    if (booked) {
      return { criterion: "booking", message: `Booked for ${booked.label} on ${day}` };
    }
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
 * PTR-29's AND-composed search rules and PTR-30's suitability verdict are one function, so a
 * venue can never pass the filter and fail suitability on the same criterion (PTR-29 AC2). Every
 * applied filter is checked and every failure named (PTR-30 AC5); `suitable` is what search
 * filters on. Kept beside its sole application caller, `handleSearchVenues`.
 */
export function evaluateVenueSuitability(
  venue: VenueSuitabilityCandidate,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[],
  bookings: readonly AvailabilityRecord[]
): SuitabilityVerdict {
  const failures: SuitabilityFailure[] = [];

  // Both filters are lower bounds and a venue must clear both, so the stricter one decides.
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
      // An event's layout preference is free text and skips the search form's guard, so it can
      // name none of the six layouts; the sentence then names what was asked for.
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
  const availability = availabilityFailure(venue, filters, blocks, bookings);
  if (availability) failures.push(availability);

  return { suitable: failures.length === 0, failures };
}

export async function handleListVenues(database: Database): Promise<Venue[]> {
  return database.select().from(venues).orderBy(asc(venues.name));
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
 * PTR-30 criterion 4's data: the approved bookings overlapping a range, per venue. An approved
 * `venue_requests` row *is* the booking (PTR-36), so this is the read the seam was waiting for;
 * the search and the availability calendar both call it, and the search's wiring stays pinned by
 * an integration test that injects its own loader. `label` is deliberately anonymous: the
 * calendar and search never leak another event's name, and the approval refusal names the venue
 * and period instead.
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
        // The same strict half-open overlap the projection and the exclusion constraint use:
        // periods that only touch at a boundary do not conflict.
        lt(venueRequests.startsAt, endsAt),
        gt(venueRequests.endsAt, startsAt)
      )
    );

  return rows.map(row => ({
    id: row.id,
    venueId: row.venueId,
    startsAt: normalizeDatabaseTimestamp(row.startsAt),
    endsAt: normalizeDatabaseTimestamp(row.endsAt),
    label: "another event",
  }));
};

/**
 * PTR-29's venue search and PTR-30's verdicts. An optional event id belongs to the assigned
 * Coordinator or is refused without revealing whether the event exists. The event's first
 * complete proposed window and hard venue requirements become defaults; explicit filters are then
 * evaluated by the one evaluator, which sorts every venue into `venues` (suitable) or `unsuitable`
 * (with its failures named). Nothing here writes: a verdict books or blocks no venue (AC6).
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
    const record = await loadAssignedEvent(database, eventId, user.id, SEARCHABLE_EVENT_STATUSES);
    if (!record) throw new AuthorizationError("Forbidden");
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

  // A hand-edited or SSR URL can carry a key whose value is `undefined`; spreading it would
  // clobber the event default, so only supplied values survive the merge.
  const suppliedValues: Record<string, unknown> = requested;
  const supplied = Object.fromEntries(
    Object.entries(suppliedValues).filter(([, value]) => value !== undefined)
  ) as Partial<VenueSearch>;
  const filters: VenueSearch = { ...defaults, ...supplied };
  const venueRows = await handleListVenues(database);
  let blocksByVenue = new Map<number, VenueBlock[]>();
  let bookingsByVenue = new Map<number, VenueBooking[]>();

  if (filters.date && venueRows.length > 0) {
    const startsAt = `${filters.date} 00:00:00`;
    const endsAt = `${nextCivilDate(filters.endDate ?? filters.date)} 00:00:00`;
    const venueIds = venueRows.map(venue => venue.id);
    const [blocks, bookings] = await Promise.all([
      loadVenueBlocks(database, venueIds, startsAt, endsAt),
      loadBookings(database, venueIds, startsAt, endsAt),
    ]);
    blocksByVenue = Map.groupBy(blocks, block => block.venueId);
    bookingsByVenue = Map.groupBy(bookings, booking => booking.venueId);
  }

  const suitable: Venue[] = [];
  const unsuitable: { venue: Venue; failures: SuitabilityFailure[] }[] = [];
  for (const venue of venueRows) {
    const verdict = evaluateVenueSuitability(
      venue,
      filters,
      blocksByVenue.get(venue.id) ?? [],
      bookingsByVenue.get(venue.id) ?? []
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
 * A venue's availability across an inclusive civil-date range (PTR-28): its opening periods,
 * minus the recorded unavailability and the approved bookings that overlap the range, as
 * floating venue-local timestamps. PTR-36 filled the booking seam, so an approved booking now
 * renders as a "confirmed" period.
 */
export async function handleGetVenueAvailability(data: unknown, database: Database) {
  const selection = parseAvailabilityRequest(data);

  const venueRows = await database
    .select({ id: venues.id, name: venues.name, operatingHours: venues.operatingHours })
    .from(venues)
    .where(eq(venues.id, selection.venueId))
    .limit(1);
  const venue = venueRows.at(0);
  // A read answers a missing row with `null`, exactly as `handleGetVenue` does: the route turns it into the router's `notFound()`, which is the right answer for the one id a visitor can mistype.
  // The 404 stays on the write path (`handleSaveVenue`), where "not there" is the operation failing.
  if (!venue) return null;

  const startsAt = `${selection.startDate}T00:00:00`;
  const endsAt = `${nextCivilDate(selection.endDate)}T00:00:00`;
  const databaseStartsAt = startsAt.replace("T", " ");
  const databaseEndsAt = endsAt.replace("T", " ");
  const [blocks, bookings] = await Promise.all([
    loadVenueBlocks(database, [venue.id], databaseStartsAt, databaseEndsAt),
    loadVenueBookings(database, [venue.id], databaseStartsAt, databaseEndsAt),
  ]);

  return {
    venue: { id: venue.id, name: venue.name },
    startDate: selection.startDate,
    endDate: selection.endDate,
    ...projectAvailability(
      { startsAt, endsAt },
      {
        // The same approved bookings the search reads (PTR-36).
        bookings,
        blocks,
        openPeriods: openingPeriods(selection.startDate, selection.endDate, venue.operatingHours),
      }
    ),
  };
}

/**
 * Postgres reports a unique violation as a driver error that Drizzle wraps; `isConstraintViolation`
 * reads the constraint name off it. Turned into the sentence the form is built to show, since a
 * duplicate name is the one conflict the UI can trigger by itself.
 */
function rethrowReadable(error: unknown): never {
  if (isConstraintViolation(error, "venues_name_unique")) {
    throw new Error(DUPLICATE_NAME_MESSAGE, { cause: error });
  }
  throw error;
}

/**
 * Create when no `id` is supplied, otherwise a full replace of that row (PTR-26 criterion 1).
 * The middleware has already checked `venue:create` or `venue:update`, deriving which from
 * `data.id` before the payload reaches `.validator(parseVenueInput)`. A row that is not there
 * becomes the 404 below rather than a refusal.
 */
export async function handleSaveVenue(data: unknown, database: Database): Promise<Venue> {
  const { id, ...fields } = parseVenueInput(data);

  if (id === undefined) {
    const [created] = await database
      .insert(venues)
      .values(fields)
      .returning()
      .catch(rethrowReadable);
    return created;
  }

  const updated = await database
    .update(venues)
    .set(fields)
    .where(eq(venues.id, id))
    .returning()
    .catch(rethrowReadable);

  if (updated.length === 0) {
    // No such venue — which is not a refusal. A 403 here told a Venue Staff member who does hold
    // `venue:update` that their role forbade a row they had merely mistyped the id of, or that
    // someone else had deleted; the 404 says what actually happened.
    throw new NotFoundError("Not Found");
  }

  return updated[0];
}
