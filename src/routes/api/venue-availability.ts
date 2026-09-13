import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuthorizationError, getSessionUser, requirePermission } from "#/features/auth/session";
import type {
  AvailabilityBlock,
  AvailabilityBooking,
  AvailabilityPeriod,
  AvailabilityProjection,
  AvailabilityRequest,
  AvailabilityTimeMode,
  OccupiedPeriod,
} from "#/features/venues/availability";
import { parseCalendarSelection } from "#/features/venues/calendar-data";
import {
  floatingPeriodStart,
  compareFloatingTimestamps,
  isCivilDate,
  isFloatingTimestamp,
  nextCivilDate,
  normalizeDatabaseTimestamp,
  weekdayForCivilDate,
} from "#/features/venues/calendar-time";
import type { OperatingHours } from "#/features/venues/schema";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const WEEKDAYS_BY_SUNDAY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseVenueId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Venue ID must be a positive integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > POSTGRES_INTEGER_MAX)
    throw new Error("Venue ID is outside the PostgreSQL integer range");
  return parsed;
}

function openingPeriods(startDate: string, endDate: string, operatingHours: OperatingHours) {
  const periods: Array<{ startsAt: string; endsAt: string }> = [];
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

const ExplicitTimestamp = z.iso.datetime({ offset: true });

function isTimestamp(value: string) {
  return isFloatingTimestamp(value) || ExplicitTimestamp.safeParse(value).success;
}

function timestampMode(value: string): AvailabilityTimeMode {
  return isFloatingTimestamp(value) ? "floating" : "instant";
}

function compareTimestamps(left: string, right: string, mode: AvailabilityTimeMode) {
  return mode === "floating"
    ? compareFloatingTimestamps(left, right)
    : Date.parse(left) - Date.parse(right);
}

function timestampField(error: string) {
  return z.string({ error }).refine(isTimestamp, error);
}

const RequestSchema = z
  .object({
    venueId: z.string({ error: "Select a venue" }).trim().min(1, "Select a venue"),
    startsAt: timestampField("Start time must be a valid timestamp with a timezone or local time"),
    endsAt: timestampField("End time must be a valid timestamp with a timezone or local time"),
  })
  .refine(
    input =>
      timestampMode(input.startsAt) === timestampMode(input.endsAt) &&
      compareTimestamps(input.endsAt, input.startsAt, timestampMode(input.startsAt)) > 0,
    { message: "End time must be after start time", path: ["endsAt"] }
  );

export function parseAvailabilityRequest(input: unknown): AvailabilityRequest {
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/** Build occupied periods and free gaps for this endpoint's complete read model. */
export function projectAvailability(
  input: AvailabilityRequest,
  source: {
    bookings: readonly AvailabilityBooking[];
    blocks: readonly AvailabilityBlock[];
    openPeriods: readonly AvailabilityPeriod[];
    pendingTreatment: "hold" | "no-hold";
    timeMode?: AvailabilityTimeMode;
  }
): AvailabilityProjection {
  const range = parseAvailabilityRequest(input);
  const mode = source.timeMode ?? timestampMode(range.startsAt);
  if (timestampMode(range.startsAt) !== mode || timestampMode(range.endsAt) !== mode)
    throw new Error("Availability contains mixed timestamp modes");

  const rangeStart = range.startsAt;
  const rangeEnd = range.endsAt;
  if (compareTimestamps(rangeEnd, rangeStart, mode) <= 0)
    throw new Error("Availability contains an invalid range");

  function clip(period: AvailabilityPeriod): AvailabilityPeriod | null {
    const periodStart = compareTimestamps(period.startsAt, rangeStart, mode);
    const periodEnd = compareTimestamps(period.endsAt, rangeStart, mode);
    if (
      !isTimestamp(period.startsAt) ||
      !isTimestamp(period.endsAt) ||
      timestampMode(period.startsAt) !== mode ||
      timestampMode(period.endsAt) !== mode ||
      Number.isNaN(periodStart) ||
      Number.isNaN(periodEnd) ||
      compareTimestamps(period.endsAt, period.startsAt, mode) <= 0
    )
      throw new Error("Availability contains an invalid period");
    if (
      compareTimestamps(period.startsAt, rangeEnd, mode) >= 0 ||
      compareTimestamps(period.endsAt, rangeStart, mode) <= 0
    )
      return null;
    return {
      startsAt:
        compareTimestamps(period.startsAt, rangeStart, mode) < 0 ? rangeStart : period.startsAt,
      endsAt: compareTimestamps(period.endsAt, rangeEnd, mode) > 0 ? rangeEnd : period.endsAt,
    };
  }

  const occupied: OccupiedPeriod[] = [];
  function addOccupied(record: AvailabilityBlock, state: OccupiedPeriod["state"]) {
    if (record.venueId !== range.venueId) return;
    const visible = clip(record);
    if (!visible) return;
    occupied.push({
      id: record.id,
      state,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      visibleStart: visible.startsAt,
      visibleEnd: visible.endsAt,
    });
  }

  for (const booking of source.bookings) {
    if (booking.status === "approved") addOccupied(booking, "confirmed");
    else if (booking.status === "pending" && source.pendingTreatment === "hold")
      addOccupied(booking, "blocked");
  }
  for (const block of source.blocks) addOccupied(block, "blocked");
  occupied.sort(
    (left, right) =>
      compareTimestamps(left.visibleStart, right.visibleStart, mode) ||
      left.id.localeCompare(right.id)
  );

  const openings = source.openPeriods
    .map(clip)
    .filter((period): period is AvailabilityPeriod => period !== null)
    .toSorted((left, right) => compareTimestamps(left.startsAt, right.startsAt, mode));
  const merged: AvailabilityPeriod[] = [];
  for (const opening of openings) {
    const previous = merged.at(-1);
    if (previous && compareTimestamps(opening.startsAt, previous.endsAt, mode) <= 0) {
      if (compareTimestamps(opening.endsAt, previous.endsAt, mode) > 0)
        previous.endsAt = opening.endsAt;
    } else merged.push({ ...opening });
  }

  const available: AvailabilityPeriod[] = [];
  for (const opening of merged) {
    let cursor = opening.startsAt;
    for (const record of occupied) {
      if (compareTimestamps(record.visibleEnd, cursor, mode) <= 0) continue;
      if (compareTimestamps(record.visibleStart, opening.endsAt, mode) >= 0) break;
      if (compareTimestamps(record.visibleStart, cursor, mode) > 0)
        available.push({ startsAt: cursor, endsAt: record.visibleStart });
      cursor =
        compareTimestamps(record.visibleEnd, opening.endsAt, mode) < 0
          ? record.visibleEnd
          : opening.endsAt;
      if (compareTimestamps(cursor, opening.endsAt, mode) >= 0) break;
    }
    if (compareTimestamps(cursor, opening.endsAt, mode) < 0)
      available.push({ startsAt: cursor, endsAt: opening.endsAt });
  }
  return { occupied, available };
}

export const Route = createFileRoute("/api/venue-availability")({
  server: {
    handlers: {
      GET: async () => {
        const [{ getRequest }, { auth }] = await Promise.all([
          import("@tanstack/react-start/server"),
          import("#/lib/auth"),
        ]);
        const request = getRequest();
        const headers = { "Cache-Control": "private, no-store" };
        const session = await auth.api.getSession({ headers: request.headers });
        try {
          requirePermission(getSessionUser(session), { venueAvailability: ["read"] });
        } catch (error) {
          if (error instanceof AuthorizationError)
            return Response.json({ error: error.message }, { status: error.status, headers });
          throw error;
        }
        let selection: ReturnType<typeof parseCalendarSelection>;
        let venueId: number;
        try {
          selection = parseCalendarSelection(Object.fromEntries(new URL(request.url).searchParams));
          if (!isCivilDate(selection.startDate) || !isCivilDate(selection.endDate))
            throw new Error("Enter valid calendar dates");
          venueId = parseVenueId(selection.venueId);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Check the venue and dates" },
            { status: 400, headers }
          );
        }

        try {
          // Keep server-only database access inside the handler; this route is reachable from the
          // generated client route tree, but the Bun SQL client cannot enter that bundle.
          const [{ db }, { venues, venueUnavailability }, { and, eq, gt, lt }] = await Promise.all([
            import("#/db"),
            import("#/db/schema"),
            import("drizzle-orm"),
          ]);
          const venueRows = await db
            .select({ id: venues.id, name: venues.name, operatingHours: venues.operatingHours })
            .from(venues)
            .where(eq(venues.id, venueId))
            .limit(1);
          const venue = venueRows.at(0);
          if (!venue) return Response.json({ error: "Venue not found" }, { status: 404, headers });

          const rangeStart = `${selection.startDate}T00:00:00`;
          const rangeEnd = `${nextCivilDate(selection.endDate)}T00:00:00`;
          const rangeStartDatabase = rangeStart.replace("T", " ");
          const rangeEndDatabase = rangeEnd.replace("T", " ");
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
                lt(venueUnavailability.startsAt, rangeEndDatabase),
                gt(venueUnavailability.endsAt, rangeStartDatabase)
              )
            );

          const projection = projectAvailability(
            { venueId: String(venue.id), startsAt: rangeStart, endsAt: rangeEnd },
            {
              bookings: [],
              blocks: blocks.map(block => ({
                id: String(block.id),
                venueId: String(block.venueId),
                startsAt: normalizeDatabaseTimestamp(block.startsAt),
                endsAt: normalizeDatabaseTimestamp(block.endsAt),
              })),
              openPeriods: openingPeriods(
                selection.startDate,
                selection.endDate,
                venue.operatingHours
              ),
              pendingTreatment: "no-hold",
              timeMode: "floating",
            }
          );

          return Response.json(
            {
              venue: { id: String(venue.id), name: venue.name },
              startDate: selection.startDate,
              endDate: selection.endDate,
              timeZone: null,
              ...projection,
            },
            { status: 200, headers }
          );
        } catch {
          return Response.json(
            { error: "Venue availability could not be loaded." },
            { status: 500, headers }
          );
        }
      },
    },
  },
});
