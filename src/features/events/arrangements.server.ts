import { and, asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  eventRequests,
  venueHolds,
  venueRequests,
  venues,
} from "#/db/schema";
import { AuthorizationError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import type { OutstandingReleases } from "#/features/events/cancellation";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`, or from another
 * `*.server.ts` module. What an event holds — its approved bookings, its held tentative holds and
 * its equipment reservations — is read here for the cancelled event's release list (PTR-54) and
 * for the warning before a significant change (PTR-23).
 */

type Database = typeof Db;

/**
 * PTR-54 AC2, AC6 and PTR-23 AC3: the approved bookings, the held tentative holds and the reserved
 * equipment of an event. Nothing here is released automatically, so an item stays listed until the
 * staff concerned release it, and leaves the list as soon as they do.
 */
export async function loadOutstandingReleases(
  database: Pick<Database, "select">,
  eventId: number
): Promise<OutstandingReleases> {
  const [venueBookings, venueHoldRows, equipmentRows] = await Promise.all([
    database
      .select({
        id: venueRequests.id,
        venueName: venues.name,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(and(eq(venueRequests.eventId, eventId), eq(venueRequests.status, "approved")))
      .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id)),
    database
      .select({
        id: venueHolds.id,
        venueId: venueHolds.venueId,
        venueName: venues.name,
        startsAt: venueHolds.startsAt,
        endsAt: venueHolds.endsAt,
      })
      .from(venueHolds)
      .innerJoin(venues, eq(venues.id, venueHolds.venueId))
      .where(and(eq(venueHolds.eventId, eventId), eq(venueHolds.status, "held")))
      .orderBy(asc(venueHolds.startsAt), asc(venueHolds.id)),
    database
      .select({
        id: equipmentRequests.id,
        item: equipmentRequests.item,
        quantity: equipmentReservations.quantity,
      })
      .from(equipmentReservations)
      .innerJoin(
        equipmentRequests,
        eq(equipmentRequests.id, equipmentReservations.equipmentRequestId)
      )
      .where(eq(equipmentRequests.eventId, eventId))
      .orderBy(asc(equipmentRequests.id)),
  ]);

  return { venueBookings, venueHolds: venueHoldRows, equipmentReservations: equipmentRows };
}

export interface ArrangementHolders {
  /** Each approved booking that still has the Venue Staff member who settled it. */
  bookings: { staffId: string; venueName: string; startsAt: string; endsAt: string }[];
  /** Each Technical Support member holding at least one reservation, once. */
  reservationStaffIds: string[];
}

/**
 * The staff who hold an event's arrangements: the Venue Staff on each approved booking, and each
 * Technical Support member with a reservation on one of the event's lines. A cancellation (PTR-54
 * AC3) and a significant change (PTR-23 AC5) both tell them. A booking or line whose staff account
 * has since been deleted has no one to tell; the cancellation list and the shared queue still
 * carry it. A tentative hold is the Coordinator's own, so it names no one.
 */
export async function loadArrangementHolders(
  database: Pick<Database, "select" | "selectDistinct">,
  eventId: number
): Promise<ArrangementHolders> {
  const [bookings, lines] = await Promise.all([
    database
      .select({
        staffId: venueRequests.assignedStaffId,
        venueName: venues.name,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(and(eq(venueRequests.eventId, eventId), eq(venueRequests.status, "approved")))
      .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id)),
    database
      .selectDistinct({ staffId: equipmentRequests.assignedStaffId })
      .from(equipmentReservations)
      .innerJoin(
        equipmentRequests,
        eq(equipmentRequests.id, equipmentReservations.equipmentRequestId)
      )
      .where(eq(equipmentRequests.eventId, eventId)),
  ]);

  return {
    bookings: bookings.flatMap(({ staffId, ...booking }) =>
      staffId === null ? [] : [{ staffId, ...booking }]
    ),
    reservationStaffIds: lines.flatMap(({ staffId }) => (staffId === null ? [] : [staffId])),
  };
}

/**
 * PTR-23 AC3: what the event holds, for the warning the Coordinator reads before a significant
 * change is saved. Only the assigned Coordinator may read it. A missing event and someone else's
 * event are refused the same way, so the refusal does not say whether the id exists; a draft has
 * no Coordinator, so it is refused here too. Reading never changes an arrangement.
 */
export async function handleListEventArrangements(
  data: unknown,
  actor: SessionUser,
  database: Pick<Database, "select">
): Promise<OutstandingReleases> {
  const input = parseEventRequestId(data);
  const event = (
    await database
      .select({ assignedCoordinatorId: eventRequests.assignedCoordinatorId })
      .from(eventRequests)
      .where(eq(eventRequests.id, input.id))
  ).at(0);
  if (!event || event.assignedCoordinatorId !== actor.id) {
    throw new AuthorizationError("Forbidden");
  }
  return loadOutstandingReleases(database, input.id);
}
