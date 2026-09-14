import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  AuthorizationError,
  getCurrentUser,
  NotFoundError,
  requirePermission,
} from "#/features/auth/session";
import {
  compareTimestamps,
  floatingPeriodStart,
  isFloatingTimestamp,
  nextCivilDate,
  normalizeDatabaseTimestamp,
  weekdayForCivilDate,
} from "#/features/venues/calendar-time";
import { parseCalendarSelection } from "#/features/venues/calendar-data";
import type {
  CalendarOccupiedPeriod,
  CalendarPeriod,
  CalendarSchedule,
} from "#/features/venues/calendar-data";
import { parseVenueId, parseVenueInput } from "#/features/venues/schema";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const WEEKDAYS_BY_SUNDAY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Routes import this module, so it stays free of any static server import — `./records.server`
 * and `#/db` are reached inside the handlers, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([
    getCurrentUser(),
    import("#/db"),
    import("#/features/venues/records.server"),
  ]);
}

async function logUnexpectedError(context: string, error: unknown): Promise<void> {
  const { logger } = await import("#/lib/logger");
  logger.error(`Venue ${context} failed`, { error });
}

/** A venue row as the client sees it — derived here so no route has to import the server module. */
export type Venue = Awaited<ReturnType<typeof listVenues>>[number];

/**
 * Rethrows a status-carrying error as a `Response`, which TanStack Start serves verbatim — that
 * is how a direct HTTP call gets the real 401/403/404 rather than a generic failure. Anything
 * else is a genuine fault and keeps travelling as an error.
 */
function refuseAsResponse(error: unknown): never {
  if (error instanceof AuthorizationError || error instanceof NotFoundError) {
    throw new Response(error.message, { status: error.status });
  }
  throw error;
}

/**
 * All three handlers want the same session, database and record module, and the same conversion
 * on the way out, so both live here once. Loading is inside the `try` so unexpected session or
 * database faults are logged before they are rethrown.
 */
async function withServer<T>(
  run: (...loaded: Awaited<ReturnType<typeof loadServer>>) => Promise<T>
): Promise<T> {
  try {
    const loaded = await loadServer();
    return await run(...loaded);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof NotFoundError)
      return refuseAsResponse(error);
    await logUnexpectedError("server function", error);
    throw error;
  }
}

export const listVenues = createServerFn({ method: "GET" }).handler(async () =>
  withServer((user, { db }, { handleListVenues }) => handleListVenues(user, db))
);

/**
 * Wrapped in an object on purpose: a server function whose result is `Venue | null` infers as
 * `never` under @tanstack/react-start 1.168 (a nullable top-level result collapses), so the
 * loader could not read `venue.name`. `{ venue }` keeps the type intact.
 */
export const getVenue = createServerFn({ method: "GET" })
  .validator(parseVenueId)
  .handler(async ({ data }) =>
    withServer(async (user, { db }, { handleGetVenue }) => ({
      venue: await handleGetVenue(data, user, db),
    }))
  );

export const saveVenue = createServerFn({ method: "POST" })
  .validator(parseVenueInput)
  .handler(async ({ data }) =>
    withServer((user, { db }, { handleSaveVenue }) => handleSaveVenue(data, user, db))
  );

const AvailabilityVenueIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Venue ID must be a positive integer")
  .refine(value => Number.isSafeInteger(Number(value)) && Number(value) <= POSTGRES_INTEGER_MAX, {
    message: "Venue ID is outside the PostgreSQL integer range",
  })
  .transform(Number);

export function parseAvailabilityInput(input: unknown) {
  const selection = parseCalendarSelection(input);
  const venueId = AvailabilityVenueIdSchema.safeParse(selection.venueId);
  if (!venueId.success) throw new Error(venueId.error.issues[0].message);
  return { ...selection, venueId: venueId.data };
}

function openingPeriods(
  startDate: string,
  endDate: string,
  operatingHours: Record<
    (typeof WEEKDAYS_BY_SUNDAY_INDEX)[number],
    { opens: string; closes: string } | null
  >
): CalendarPeriod[] {
  const periods: CalendarPeriod[] = [];
  for (let date = startDate; date <= endDate; date = nextCivilDate(date)) {
    const day = operatingHours[WEEKDAYS_BY_SUNDAY_INDEX[weekdayForCivilDate(date)]];
    if (day) {
      periods.push({
        startsAt: floatingPeriodStart(date, day.opens),
        endsAt: floatingPeriodStart(date, day.closes),
      });
    }
  }
  return periods;
}

/** Build the block-only read projection for the availability calendar. */
export function projectAvailability(
  input: { venueId: string; startsAt: string; endsAt: string },
  source: {
    blocks: readonly (CalendarPeriod & { id: string; venueId: string })[];
    openPeriods: readonly CalendarPeriod[];
  }
): Pick<CalendarSchedule, "occupied" | "available"> {
  const range = input;
  if (
    !isFloatingTimestamp(range.startsAt) ||
    !isFloatingTimestamp(range.endsAt) ||
    compareTimestamps(range.endsAt, range.startsAt) <= 0
  ) {
    throw new Error("Availability contains an invalid range");
  }

  function clip(period: CalendarPeriod): CalendarPeriod | null {
    if (
      !isFloatingTimestamp(period.startsAt) ||
      !isFloatingTimestamp(period.endsAt) ||
      compareTimestamps(period.endsAt, period.startsAt) <= 0
    )
      throw new Error("Availability contains an invalid period");
    if (
      compareTimestamps(period.startsAt, range.endsAt) >= 0 ||
      compareTimestamps(period.endsAt, range.startsAt) <= 0
    )
      return null;
    return {
      startsAt:
        compareTimestamps(period.startsAt, range.startsAt) < 0 ? range.startsAt : period.startsAt,
      endsAt: compareTimestamps(period.endsAt, range.endsAt) > 0 ? range.endsAt : period.endsAt,
    };
  }

  const occupied = source.blocks
    .filter(block => block.venueId === range.venueId)
    .map((block): CalendarOccupiedPeriod | null => {
      const visible = clip(block);
      if (!visible) return null;
      return {
        id: block.id,
        state: "blocked" as const,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        visibleStart: visible.startsAt,
        visibleEnd: visible.endsAt,
      };
    })
    .filter((period): period is CalendarOccupiedPeriod => period !== null)
    .toSorted(
      (left, right) =>
        compareTimestamps(left.visibleStart, right.visibleStart) || left.id.localeCompare(right.id)
    );

  const openings = source.openPeriods
    .map(clip)
    .filter((period): period is CalendarPeriod => period !== null)
    .toSorted((left, right) => compareTimestamps(left.startsAt, right.startsAt));
  const merged: CalendarPeriod[] = [];
  for (const opening of openings) {
    const previous = merged.at(-1);
    if (previous && compareTimestamps(opening.startsAt, previous.endsAt) <= 0) {
      if (compareTimestamps(opening.endsAt, previous.endsAt) > 0) previous.endsAt = opening.endsAt;
    } else merged.push({ ...opening });
  }

  const available: CalendarPeriod[] = [];
  for (const opening of merged) {
    let cursor = opening.startsAt;
    for (const record of occupied) {
      if (compareTimestamps(record.visibleEnd, cursor) <= 0) continue;
      if (compareTimestamps(record.visibleStart, opening.endsAt) >= 0) break;
      if (compareTimestamps(record.visibleStart, cursor) > 0)
        available.push({ startsAt: cursor, endsAt: record.visibleStart });
      cursor =
        compareTimestamps(record.visibleEnd, opening.endsAt) < 0
          ? record.visibleEnd
          : opening.endsAt;
      if (compareTimestamps(cursor, opening.endsAt) >= 0) break;
    }
    if (compareTimestamps(cursor, opening.endsAt) < 0)
      available.push({ startsAt: cursor, endsAt: opening.endsAt });
  }

  return {
    occupied,
    available,
  };
}

export const getVenueAvailability = createServerFn({ method: "GET" })
  .validator(parseAvailabilityInput)
  .handler(async ({ data }): Promise<CalendarSchedule | Response> => {
    try {
      const user = await getCurrentUser();
      const [{ db }, { venues, venueUnavailability }, { and, eq, gt, lt }] = await Promise.all([
        import("#/db"),
        import("#/db/schema"),
        import("drizzle-orm"),
      ]);
      requirePermission(user, { venueAvailability: ["read"] });

      const venueId = data.venueId;
      const venueRows = await db
        .select({ id: venues.id, name: venues.name, operatingHours: venues.operatingHours })
        .from(venues)
        .where(eq(venues.id, venueId))
        .limit(1);
      const venue = venueRows.at(0);
      if (!venue) throw new NotFoundError("Venue not found");

      const rangeStart = `${data.startDate}T00:00:00`;
      const rangeEnd = `${nextCivilDate(data.endDate)}T00:00:00`;
      const blocks = await db
        .select({
          id: venueUnavailability.id,
          venueId: venueUnavailability.venueId,
          startsAt: venueUnavailability.startsAt,
          endsAt: venueUnavailability.endsAt,
        })
        .from(venueUnavailability)
        .where(
          and(
            eq(venueUnavailability.venueId, venueId),
            lt(venueUnavailability.startsAt, rangeEnd.replace("T", " ")),
            gt(venueUnavailability.endsAt, rangeStart.replace("T", " "))
          )
        );
      const projection = projectAvailability(
        { venueId: String(venue.id), startsAt: rangeStart, endsAt: rangeEnd },
        {
          blocks: blocks.map(block => ({
            id: String(block.id),
            venueId: String(block.venueId),
            startsAt: normalizeDatabaseTimestamp(block.startsAt),
            endsAt: normalizeDatabaseTimestamp(block.endsAt),
          })),
          openPeriods: openingPeriods(data.startDate, data.endDate, venue.operatingHours),
        }
      );
      return {
        venue: { id: String(venue.id), name: venue.name },
        startDate: data.startDate,
        endDate: data.endDate,
        timeZone: null,
        ...projection,
      };
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof NotFoundError)
        return refuseAsResponse(error);
      await logUnexpectedError("availability read", error);
      throw error;
    }
  });
