import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, venueUnavailability, venues } from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { AuthorizationError, NotFoundError } from "#/features/auth/session";
import { eventTiming } from "#/features/events/access";
import {
  nextCivilDate,
  normalizeDatabaseTimestamp,
  openingPeriods,
  projectAvailability,
} from "#/features/venues/availability";
import type { AvailabilityRecord } from "#/features/venues/availability";
import {
  DUPLICATE_NAME_MESSAGE,
  crossesMidnight,
  parseAvailabilityRequest,
  parseLayouts,
  parseVenueId,
  parseVenueInput,
  parseVenueSearchRequest,
} from "#/features/venues/schema";
import type { OperatingHours, VenueLayout, VenueSearch } from "#/features/venues/schema";

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
 * Every requested word must be one of the venue's stored tag words, in any order, so a stored tag
 * with extra words still satisfies a shorter request and punctuation is just a separator.
 *
 * ponytail: exact word-set matching, no synonyms — "PA system" does not match a stored "Sound and
 * lighting system". Add a synonym table (or embeddings) if cross-vocabulary recall matters.
 */
function hasEveryTag(actual: readonly string[], requested: string | undefined) {
  if (!requested) return true;
  const available = new Set(actual.flatMap(tagWords));
  return tagWords(requested).every(word => available.has(word));
}

function isAvailable(
  venue: VenueSuitabilityCandidate,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[]
) {
  if (!filters.date) return true;

  const endDate = filters.endDate ?? filters.date;
  const range = {
    startsAt: `${filters.date}T00:00:00`,
    endsAt: `${nextCivilDate(endDate)}T00:00:00`,
  };
  const projection = projectAvailability(range, {
    bookings: [],
    blocks,
    openPeriods: openingPeriods(filters.date, endDate, venue.operatingHours),
  });

  if (!filters.startTime || !filters.endTime) return projection.available.length > 0;

  // The times are a daily hosting window, not one continuous period: a two-day search needs each
  // day covered on its own, and a window running past midnight fits no civil day at all.
  if (crossesMidnight(filters)) return false;

  for (let day = filters.date; day <= endDate; day = nextCivilDate(day)) {
    const requestedStart = `${day}T${filters.startTime}:00`;
    const requestedEnd = `${day}T${filters.endTime}:00`;
    if (
      !projection.available.some(
        period => period.startsAt <= requestedStart && period.endsAt >= requestedEnd
      )
    ) {
      return false;
    }
  }
  return true;
}

/** PTR-29's AND-composed search rules, kept beside their sole application caller. */
export function evaluateVenueSuitability(
  venue: VenueSuitabilityCandidate,
  filters: VenueSearch,
  blocks: readonly AvailabilityRecord[]
) {
  // Both filters are lower bounds and a venue must clear both, so the stricter one decides.
  const requiredCapacity = Math.max(filters.expectedAttendance ?? 0, filters.capacity ?? 0);
  if (requiredCapacity > venue.maxCapacity) return false;
  if (filters.location && !normalise(venue.location).includes(normalise(filters.location))) {
    return false;
  }
  if (filters.layout) {
    const requested = parseLayouts(filters.layout);
    if (!requested.some(layout => venue.supportedLayouts.includes(layout))) return false;
  }
  if (!hasEveryTag(venue.accessibilityFeatures, filters.accessibility)) return false;
  if (!hasEveryTag(venue.facilities, filters.facilities)) return false;
  return isAvailable(venue, filters, blocks);
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

/**
 * PTR-29's venue search. An optional event id belongs to the assigned Coordinator or is refused
 * without revealing whether the event exists. The event's first complete proposed window and
 * hard venue requirements become defaults; explicit filters are then ANDed by one evaluator.
 */
export async function handleSearchVenues(data: unknown, user: SessionUser, database: Database) {
  const { eventId, ...requested } = parseVenueSearchRequest(data);
  let event: { id: number; name: string } | null = null;
  let defaults: VenueSearch = {};

  if (eventId !== undefined) {
    const records = await database
      .select({
        id: eventRequests.id,
        name: eventRequests.eventName,
        proposedDates: eventRequests.proposedDates,
        expectedAttendance: eventRequests.expectedAttendance,
        layout: eventRequests.roomLayoutPreference,
        accessibility: eventRequests.accessibilityRequirements,
        facilities: eventRequests.venueRequirements,
      })
      .from(eventRequests)
      .where(
        and(
          eq(eventRequests.id, eventId),
          eq(eventRequests.status, "submitted"),
          eq(eventRequests.assignedCoordinatorId, user.id)
        )
      )
      .limit(1);
    const record = records.at(0);

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
      layout: record.layout || undefined,
      accessibility: record.accessibility || undefined,
      facilities: record.facilities || undefined,
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

  if (filters.date && venueRows.length > 0) {
    const startsAt = `${filters.date} 00:00:00`;
    const endsAt = `${nextCivilDate(filters.endDate ?? filters.date)} 00:00:00`;
    blocksByVenue = Map.groupBy(
      await loadVenueBlocks(
        database,
        venueRows.map(venue => venue.id),
        startsAt,
        endsAt
      ),
      block => block.venueId
    );
  }

  return {
    event,
    filters,
    venues: venueRows.filter(venue =>
      evaluateVenueSuitability(venue, filters, blocksByVenue.get(venue.id) ?? [])
    ),
  };
}

export async function handleGetVenue(data: unknown, database: Database): Promise<Venue | null> {
  const { id } = parseVenueId(data);
  const rows = await database.select().from(venues).where(eq(venues.id, id));
  return rows.at(0) ?? null;
}

/**
 * A venue's availability across an inclusive civil-date range (PTR-28): its opening periods,
 * minus the recorded unavailability that overlaps the range, as floating venue-local timestamps.
 *
 * AC3 is mocked. Approved-booking persistence belongs to PTR-31/PTR-33, so there is no booking
 * row to read and `bookings: []` below is the seam those stories fill — `projectAvailability`
 * already renders an approved booking as a "confirmed" period, and the unit test pins that,
 * but the live calendar reports recorded unavailability only until the booking table exists.
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
  const blocks = await loadVenueBlocks(database, [venue.id], databaseStartsAt, databaseEndsAt);

  return {
    venue: { id: venue.id, name: venue.name },
    startDate: selection.startDate,
    endDate: selection.endDate,
    ...projectAvailability(
      { startsAt, endsAt },
      {
        // AC3 is mocked: there is no booking table to read until PTR-31/PTR-33, so this is the
        // seam, not a fallback. The projection's "confirmed" branch is pinned by the unit test.
        bookings: [],
        blocks,
        openPeriods: openingPeriods(selection.startDate, selection.endDate, venue.operatingHours),
      }
    ),
  };
}

/**
 * Postgres reports a unique violation as a driver error that Drizzle wraps; the constraint
 * name is on `cause`. Turned into the sentence the form is built to show, since a duplicate
 * name is the one conflict the UI can trigger by itself.
 */
function rethrowReadable(error: unknown): never {
  if (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "constraint" in error.cause &&
    error.cause.constraint === "venues_name_unique"
  ) {
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
