import { createFileRoute } from "@tanstack/react-router";
import { AuthorizationError, getSessionUser, requirePermission } from "#/features/auth/session";
import { projectAvailability } from "#/features/venues/availability";
import { parseCalendarSelection } from "#/features/venues/calendar-data";
import {
  floatingPeriodStart,
  isCivilDate,
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
