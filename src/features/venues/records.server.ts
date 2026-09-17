import { and, asc, eq, gt, lt } from "drizzle-orm";

import type { db as Db } from "#/db";
import { venueUnavailability, venues } from "#/db/schema";
import { NotFoundError } from "#/features/auth/session";
import {
  nextCivilDate,
  normalizeDatabaseTimestamp,
  openingPeriods,
  projectAvailability,
} from "#/features/venues/availability";
import {
  DUPLICATE_NAME_MESSAGE,
  parseAvailabilityRequest,
  parseVenueId,
  parseVenueInput,
} from "#/features/venues/schema";

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

export async function handleListVenues(database: Database): Promise<Venue[]> {
  return database.select().from(venues).orderBy(asc(venues.name));
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
  const blocks = await database
    .select({
      id: venueUnavailability.id,
      startsAt: venueUnavailability.startsAt,
      endsAt: venueUnavailability.endsAt,
      reason: venueUnavailability.reason,
    })
    .from(venueUnavailability)
    .where(
      and(
        eq(venueUnavailability.venueId, venue.id),
        lt(venueUnavailability.startsAt, databaseEndsAt),
        gt(venueUnavailability.endsAt, databaseStartsAt)
      )
    );

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
        blocks: blocks.map(block => ({
          id: String(block.id),
          startsAt: normalizeDatabaseTimestamp(block.startsAt),
          endsAt: normalizeDatabaseTimestamp(block.endsAt),
          label: block.reason || "Unavailable / blocked",
        })),
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
