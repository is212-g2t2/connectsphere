import { and, asc, eq, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  eventCancellationRequests,
  eventRegistrations,
  eventRequests,
  venueHolds,
  venueRequests,
  venues,
} from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  EVENT_CANCELLATION_CLOSED,
  canRequestEventCancellation,
  parseEventCancellationDeclineInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { NO_CANCELLATION_REQUEST_MESSAGE } from "#/features/events/cancellation";
import type { OutstandingReleases } from "#/features/events/cancellation";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event_request:coordinate`.
 */

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-54 AC2, AC6: the approved bookings, the held tentative holds and the reserved equipment of
 * an event, each still waiting for the staff concerned to release it. The Coordinator's page reads
 * this for a cancelled event, so an item leaves the list as soon as it is released.
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

/**
 * The assigned Coordinator's event with its waiting cancellation request, both locked. The event
 * row lock serialises the decision with a second Coordinator action and with new bookings,
 * reservations and registrations, whose own event locks then read the new status. A missing event
 * and someone else's are refused the same way.
 */
async function lockEventWithWaitingRequest(tx: Tx, eventId: number, actor: SessionUser) {
  const event = (
    await tx.select().from(eventRequests).where(eq(eventRequests.id, eventId)).for("update")
  ).at(0);
  if (!event || event.status === "draft" || event.assignedCoordinatorId !== actor.id) {
    throw new AuthorizationError("Forbidden");
  }

  const request = (
    await tx
      .select({ id: eventCancellationRequests.id })
      .from(eventCancellationRequests)
      .where(
        and(
          eq(eventCancellationRequests.eventRequestId, event.id),
          isNull(eventCancellationRequests.outcome)
        )
      )
      .for("update")
  ).at(0);
  if (!request) throw new ConflictError(NO_CANCELLATION_REQUEST_MESSAGE);

  return { event, request };
}

function eventName(event: { eventName: string }): string {
  return event.eventName.trim() || "Untitled event";
}

/**
 * PTR-54: the assigned Coordinator processes a waiting cancellation request as a cancellation. The
 * event becomes `cancelled` with who and when (AC1), and the request keeps its outcome on the
 * record (AC7). Nothing the event holds is released (AC6): the Coordinator is shown what is still
 * held (AC2), and the staff holding it, the registered Attendees and the Organiser are told
 * (AC3, AC4, AC7). Everything commits together; the worker sends the emails.
 */
export async function handleCancelEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const { event, request } = await lockEventWithWaitingRequest(tx, input.id, actor);
    // A request can wait while the event is completed (PTR-25); it can then only be declined.
    if (!canRequestEventCancellation(event.status)) {
      throw new ConflictError(EVENT_CANCELLATION_CLOSED);
    }

    const now = new Date();
    const [cancelled] = await tx
      .update(eventRequests)
      .set({
        status: "cancelled",
        cancelledById: actor.id,
        cancelledByName: actor.name,
        cancelledAt: now,
      })
      .where(eq(eventRequests.id, event.id))
      .returning();
    await tx
      .update(eventCancellationRequests)
      .set({
        outcome: "cancelled",
        processedById: actor.id,
        processedByName: actor.name,
        processedAt: now,
      })
      .where(eq(eventCancellationRequests.id, request.id));

    const outstandingReleases = await loadOutstandingReleases(tx, event.id);
    await raiseNotifications(tx, [
      ...(await staffNotices(tx, event.id, eventName(event))),
      ...(await attendeeNotices(tx, event.id, eventName(event))),
      {
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_cancelled",
        payload: { audience: "organiser", eventName: eventName(event) },
      },
    ]);

    return { event: cancelled, outstandingReleases };
  });
}

/**
 * PTR-54 AC3: the Venue Staff who settled each approved booking, one notice per booking because
 * their copy names the booking rather than the event (PTR-8), and each Technical Support member
 * holding a reservation, once. A booking or line with no staff member on it (an account since
 * deleted) has no one to tell; it stays in the shared queue and on the Coordinator's list.
 */
async function staffNotices(
  tx: Pick<Database, "select" | "selectDistinct">,
  eventId: number,
  name: string
): Promise<NewNotification[]> {
  const [bookings, lines] = await Promise.all([
    tx
      .select({
        staffId: venueRequests.assignedStaffId,
        venueName: venues.name,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(and(eq(venueRequests.eventId, eventId), eq(venueRequests.status, "approved"))),
    tx
      .selectDistinct({ staffId: equipmentRequests.assignedStaffId })
      .from(equipmentReservations)
      .innerJoin(
        equipmentRequests,
        eq(equipmentRequests.id, equipmentReservations.equipmentRequestId)
      )
      .where(eq(equipmentRequests.eventId, eventId)),
  ]);

  const notices: NewNotification[] = [];
  for (const { staffId, venueName, startsAt, endsAt } of bookings) {
    if (!staffId) continue;
    notices.push({
      recipientId: staffId,
      eventRequestId: eventId,
      kind: "event_cancelled",
      payload: { audience: "venue_staff", venueName, startsAt, endsAt },
    });
  }
  for (const { staffId } of lines) {
    if (!staffId) continue;
    notices.push({
      recipientId: staffId,
      eventRequestId: eventId,
      kind: "event_cancelled",
      payload: { audience: "technical_support", eventName: name },
    });
  }
  return notices;
}

/** PTR-54 AC4: every Attendee who holds a `registered` registration, VIPs included. */
async function attendeeNotices(
  tx: Pick<Database, "select">,
  eventId: number,
  name: string
): Promise<NewNotification[]> {
  const registrations = await tx
    .select({ attendeeId: eventRegistrations.attendeeId })
    .from(eventRegistrations)
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "registered"))
    );
  return registrations.map(({ attendeeId }) => ({
    recipientId: attendeeId,
    eventRequestId: eventId,
    kind: "event_cancelled",
    payload: { audience: "attendee", eventName: name },
  }));
}

/**
 * PTR-54 AC8: the assigned Coordinator declines a waiting cancellation request with a reason. The
 * event is left as it is; the request keeps its outcome and reason on the record, and the
 * Organiser is told.
 */
export async function handleDeclineEventCancellation(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseEventCancellationDeclineInput(data);

  return database.transaction(async tx => {
    const { event, request } = await lockEventWithWaitingRequest(tx, input.id, actor);

    const [declined] = await tx
      .update(eventCancellationRequests)
      .set({
        outcome: "declined",
        declineReason: input.reason,
        processedById: actor.id,
        processedByName: actor.name,
        processedAt: new Date(),
      })
      .where(eq(eventCancellationRequests.id, request.id))
      .returning();
    await raiseNotifications(tx, [
      {
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_cancellation_declined",
        payload: { eventName: eventName(event), reason: input.reason },
      },
    ]);

    return declined;
  });
}
