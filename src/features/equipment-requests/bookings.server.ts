import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { venueOccupancy, venueRequests, venues } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";

/** Read each booking's stored buffers, including all pieces of a split ledger row. */
export function selectEquipmentBookings(database: Pick<typeof Db, "select">, eventIds: number[]) {
  const extent = database
    .select({
      venueRequestId: venueOccupancy.venueRequestId,
      startsAt:
        sql<string>`min(${venueOccupancy.startsAt} - make_interval(mins => ${venueOccupancy.setupMinutes}))`.as(
          "buffered_start"
        ),
      endsAt:
        sql<string>`max(${venueOccupancy.endsAt} + make_interval(mins => ${venueOccupancy.turnaroundMinutes}))`.as(
          "buffered_end"
        ),
      suspended: sql<boolean>`bool_or(not ${venueOccupancy.active})`.as("suspended"),
    })
    .from(venueOccupancy)
    .where(inArray(venueOccupancy.eventId, eventIds))
    .groupBy(venueOccupancy.venueRequestId)
    .as("booking_extent");

  return database
    .select({
      id: venueRequests.id,
      eventId: venueRequests.eventId,
      venueId: venueRequests.venueId,
      venueName: venues.name,
      startsAt: sql<string>`coalesce(${extent.startsAt}, ${venueRequests.startsAt} - make_interval(mins => ${venues.setupMinutes}))::text`,
      endsAt: sql<string>`coalesce(${extent.endsAt}, ${venueRequests.endsAt} + make_interval(mins => ${venues.turnaroundMinutes}))::text`,
      suspended: sql<boolean>`coalesce(${extent.suspended}, false)`,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .leftJoin(extent, eq(extent.venueRequestId, venueRequests.id))
    .where(and(inArray(venueRequests.eventId, eventIds), eq(venueRequests.status, "approved")))
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));
}

/** Require an explicit target when more than one active booking is available. */
export function chooseEquipmentBooking<T extends { id: string; suspended: boolean }>(
  bookings: T[],
  venueRequestId?: string,
  emptyMessage = "Event must have an approved venue booking before equipment can be reserved"
): T {
  const active = bookings.filter(booking => !booking.suspended);
  if (active.length === 0) {
    throw new ConflictError(emptyMessage);
  }
  const selected = venueRequestId
    ? active.find(booking => booking.id === venueRequestId)
    : active.length === 1
      ? active[0]
      : undefined;
  if (!selected) throw new ConflictError("Choose an active approved venue booking for this line");
  return selected;
}
