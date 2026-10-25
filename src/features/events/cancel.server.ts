import { and, eq, inArray, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  eventCancellationRequests,
  eventChangeRequests,
  eventRegistrations,
  eventRequests,
} from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  EVENT_CANCELLATION_CLOSED,
  canRequestEventCancellation,
  parseEventCancellationDeclineInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { loadArrangementHolders } from "#/features/events/arrangements.server";
import {
  EVENT_CANCELLED_CLOSEOUT_REASON,
  NO_CANCELLATION_REQUEST_MESSAGE,
} from "#/features/events/cancellation";
import { closeOutProcessorName } from "#/features/events/completion";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

/** Server-only: keep this module off the client. `server-fns.ts` loads it inside the handler. */

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Lock the assigned Coordinator's event and pending cancellation request. The event lock serialises
 * this decision with other event writes, including bookings, holds, reservations, and registrations.
 * Those writes also lock the event and read its current status. Refuse a missing event and a foreign
 * event in the same way.
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
 * PTR-54: The assigned Coordinator cancels the event in response to its pending request. Record
 * who cancelled it and when (AC1), and keep the request outcome (AC7). Do not release its bookings
 * or equipment (AC6). List the held items to the Coordinator (AC2), and notify the holders,
 * registered Attendees, and Organiser (AC3, AC4, AC7). Commit the changes together. The worker
 * sends the emails.
 *
 * PTR-156: the same transaction declines every other waiting change request. The cancelling
 * Coordinator is the processor, and the Organiser gets the existing decline notice for each.
 */
export async function handleCancelEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const { event, request } = await lockEventWithWaitingRequest(tx, input.id, actor);
    // The event can be completed while the request waits (PTR-25). Then the Coordinator can only decline it.
    if (!canRequestEventCancellation(event.status)) {
      throw new ConflictError(EVENT_CANCELLATION_CLOSED);
    }

    const now = new Date();
    const [cancelled] = await tx
      .update(eventRequests)
      .set({
        status: "cancelled",
        cancelledById: actor.id,
        cancelledByName: closeOutProcessorName(actor),
        cancelledAt: now,
      })
      .where(eq(eventRequests.id, event.id))
      .returning();
    await tx
      .update(eventCancellationRequests)
      .set({
        outcome: "cancelled",
        processedById: actor.id,
        processedByName: closeOutProcessorName(actor),
        processedAt: now,
      })
      .where(eq(eventCancellationRequests.id, request.id));

    // The consumed request was the only waiting cancellation request; the open-request index
    // admits no second one. Decline what else waits so the queue holds only actionable rows.
    const staleChanges = await tx
      .update(eventChangeRequests)
      .set({
        outcome: "declined",
        declineReason: EVENT_CANCELLED_CLOSEOUT_REASON,
        processedById: actor.id,
        processedByName: closeOutProcessorName(actor),
        processedAt: now,
      })
      .where(
        and(eq(eventChangeRequests.eventRequestId, event.id), isNull(eventChangeRequests.outcome))
      )
      .returning({ whatShouldChange: eventChangeRequests.whatShouldChange });

    await raiseNotifications(tx, [
      ...(await staffNotices(tx, event.id, eventName(event))),
      ...(await attendeeNotices(tx, event.id, eventName(event))),
      {
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_cancelled",
        payload: { audience: "organiser", eventName: eventName(event) },
      },
      ...staleChanges.map(change => ({
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_change_processed" as const,
        payload: {
          outcome: "declined" as const,
          eventName: eventName(event),
          whatShouldChange: change.whatShouldChange,
          reason: EVENT_CANCELLED_CLOSEOUT_REASON,
        },
      })),
    ]);

    // A cancelled event clears its waiting list. The waitlisted Attendees above already hold
    // their cancellation notice.
    await tx
      .update(eventRegistrations)
      .set({ status: "withdrawn" })
      .where(
        and(eq(eventRegistrations.eventId, event.id), eq(eventRegistrations.status, "waitlisted"))
      );

    return cancelled;
  });
}

/**
 * PTR-54 AC3: Notify the Venue Staff member for each approved booking, once per booking. Their
 * notice names the booking, not the event (PTR-8). Notify each Technical Support member with a
 * reservation once. If a staff account was deleted, no one receives a notice. Keep the item in the
 * shared queue and on the Coordinator's list.
 */
async function staffNotices(
  tx: Pick<Database, "select" | "selectDistinct">,
  eventId: number,
  name: string
): Promise<NewNotification[]> {
  const { bookings, reservationStaffIds } = await loadArrangementHolders(tx, eventId);

  const notices: NewNotification[] = [];
  for (const { staffId, venueName, startsAt, endsAt } of bookings) {
    notices.push({
      recipientId: staffId,
      eventRequestId: eventId,
      kind: "event_cancelled",
      payload: { audience: "venue_staff", venueName, startsAt, endsAt },
    });
  }
  for (const staffId of reservationStaffIds) {
    notices.push({
      recipientId: staffId,
      eventRequestId: eventId,
      kind: "event_cancelled",
      payload: { audience: "technical_support", eventName: name },
    });
  }
  return notices;
}

/** PTR-54 AC4: Return every Attendee with a `registered` row, including VIPs, and every waitlisted Attendee. */
async function attendeeNotices(
  tx: Pick<Database, "select">,
  eventId: number,
  name: string
): Promise<NewNotification[]> {
  const registrations = await tx
    .select({ attendeeId: eventRegistrations.attendeeId })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.eventId, eventId),
        inArray(eventRegistrations.status, ["registered", "waitlisted"])
      )
    );
  return registrations.map(({ attendeeId }) => ({
    recipientId: attendeeId,
    eventRequestId: eventId,
    kind: "event_cancelled",
    payload: { audience: "attendee", eventName: name },
  }));
}

/** PTR-54 AC8: Decline the pending cancellation request with a reason. Keep the event unchanged and notify the Organiser. */
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
        processedByName: closeOutProcessorName(actor),
        processedAt: new Date(),
      })
      .where(eq(eventCancellationRequests.id, request.id))
      .returning();
    await raiseNotifications(tx, [
      {
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_cancellation_declined",
        payload: { eventName: eventName(event), reason: input.reason, eventStatus: event.status },
      },
    ]);

    return declined;
  });
}
