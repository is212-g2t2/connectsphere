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
 * Keep this module server-only. Its value import of `#/db/schema` builds tables at module scope,
 * so the bundler keeps the full module. `server-fns.ts` loads it dynamically inside `.handler()`,
 * or another `*.server.ts` module imports it. Read what an event holds here: approved bookings,
 * held tentative holds, and equipment reservations. The release list for a cancelled event
 * (PTR-54) and the significant-change warning (PTR-23) use this read.
 */

type Database = typeof Db;

/**
 * PTR-54 AC2, AC6 and PTR-23 AC3: Return the event's approved bookings, held tentative holds,
 * and reserved equipment. Release nothing automatically. An item stays listed until the
 * responsible staff release it. It leaves the list as soon as they do.
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
  /** Each approved booking with the Venue Staff member who settled it. */
  bookings: { staffId: string; venueName: string; startsAt: string; endsAt: string }[];
  /** Each Technical Support member with a reservation, listed once. */
  reservationStaffIds: string[];
}

/**
 * List the staff who hold an event's arrangements: the Venue Staff on each approved booking, and
 * each Technical Support member with a reservation on an event line. A cancellation (PTR-54 AC3)
 * and a significant change (PTR-23 AC5) both notify them. A booking or line with a deleted staff
 * account names no one to notify. The cancellation list and the shared queue still carry the
 * item. A tentative hold belongs to the Coordinator, so it names no one.
 */
export async function loadArrangementHolders(
  database: Pick<Database, "select" | "selectDistinct">,
  eventId: number
): Promise<ArrangementHolders> {
  // A transaction handle serves one query at a time. Read in sequence: both callers
  // (significant-change warning, cancellation) pass their tx.
  const bookings = await database
    .select({
      staffId: venueRequests.assignedStaffId,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(and(eq(venueRequests.eventId, eventId), eq(venueRequests.status, "approved")))
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));
  const lines = await database
    .selectDistinct({ staffId: equipmentRequests.assignedStaffId })
    .from(equipmentReservations)
    .innerJoin(
      equipmentRequests,
      eq(equipmentRequests.id, equipmentReservations.equipmentRequestId)
    )
    .where(eq(equipmentRequests.eventId, eventId));

  return {
    bookings: bookings.flatMap(({ staffId, ...booking }) =>
      staffId === null ? [] : [{ staffId, ...booking }]
    ),
    reservationStaffIds: lines.flatMap(({ staffId }) => (staffId === null ? [] : [staffId])),
  };
}

/**
 * PTR-23 AC3: List what the event holds for the Coordinator's warning before a significant
 * change. Only the assigned Coordinator may read it. Refuse a missing event and another user's
 * event in the same way. The refusal then reveals nothing about the id. Refuse a draft too. It
 * has no Coordinator. Reading changes no arrangement.
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
