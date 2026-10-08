import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventChangeRequests, eventInformationChanges, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { amendedValues, amendmentsBetween } from "#/features/event-requests/amendments";
import {
  CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE,
  CHANGE_REQUEST_NOT_WAITING_MESSAGE,
  EVENT_CHANGE_REQUEST_CLOSED,
  EVENT_INFORMATION_FIELDS,
  EVENT_REQUEST_STATUS_LABELS,
  SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE,
  canApplyEventChangeRequest,
  canUpdateEventInformation,
  parseEventChangeRequestDeclineInput,
  parseEventInformationInput,
  significantFields,
} from "#/features/event-requests/schema";
import type { ClarificationField, SignificantField } from "#/features/event-requests/schema";
import { loadArrangementHolders } from "#/features/events/arrangements.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

// Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
// reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
// pipeline has already verified the session and `event_request:coordinate`.

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface EventInformationUpdated {
  changedFields: ClarificationField[];
  /** PTR-23 AC5: how many notices went to staff holding an arrangement; 0 for an ordinary edit. */
  notified: number;
}

/**
 * PTR-22 AC2/AC4: the assigned Coordinator updates an approved, planning or confirmed event. The
 * event row is locked first, and the amendments are written over the locked values, so a field
 * the Coordinator did not touch keeps its stored value. Each changed field gets one change-log
 * row, in the same transaction as the update. A save that changes nothing writes nothing. Every
 * view reads the row live, so the next read shows the new values (AC3).
 *
 * PTR-23: a significant change (AC1) is refused until the Coordinator acknowledges the warning
 * that names what the event holds (AC2), and once saved it tells the staff holding a booking or a
 * reservation (AC5). The arrangements themselves are not touched (AC3).
 *
 * PTR-52: a save that carries `changeRequestId` applies the Organiser's waiting change request. It
 * is open in every status the request could be raised in, it must change something, and the
 * request is marked applied and the Organiser told in the same transaction (AC2, AC5). Nothing
 * else moves (AC4).
 */
export async function handleUpdateEventInformation(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<EventInformationUpdated> {
  const input = parseEventInformationInput(data);

  return database.transaction(async tx => {
    const { request, changeRequest } = await lockForUpdate(tx, input, actor);

    const values = amendedValues(request, input.amendments);
    const changes = amendmentsBetween(request, values, EVENT_INFORMATION_FIELDS);
    if (changes.length === 0) {
      // An apply must change the record; a no-change save is refused so the request stays waiting.
      if (changeRequest) throw new ConflictError(CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE);
      return { changedFields: [], notified: 0 };
    }

    // Decided on what actually changed, not on what the form touched: a field typed over and
    // restored is no change. The refusal rolls the locked row back untouched.
    const significant = significantFields(changes.map(change => change.field));
    if (significant.length > 0 && input.acknowledgeSignificant !== true) {
      throw new ConflictError(SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE);
    }

    await tx
      .update(eventRequests)
      .set({
        ...values,
        expectedAttendance: values.expectedAttendance ?? null,
        registrationCapacity: values.registrationCapacity ?? null,
        registrationOpensAt: values.registrationOpensAt ?? null,
        registrationClosesAt: values.registrationClosesAt ?? null,
      })
      .where(eq(eventRequests.id, request.id));

    const appliedAt = new Date();
    const actorName = actor.name?.trim();
    await tx.insert(eventInformationChanges).values(
      changes.map(({ field, from, to }) => ({
        eventRequestId: request.id,
        field,
        amendment: { from, to },
        changedById: actor.id,
        changedByName: actorName || actor.email,
        // `now()` defaults to the transaction timestamp, which predates a wait on the row lock,
        // so overlapping saves could be logged out of order.
        changedAt: appliedAt,
      }))
    );

    // The event's name as it now is, so a notice never names an event by a name the same save
    // replaced.
    const notices =
      significant.length > 0
        ? await significantChangeNotices(
            tx,
            { id: request.id, eventName: values.eventName },
            significant,
            // A role word, never the address: the notice goes to staff outside the event's team.
            actorName || "The Coordinator"
          )
        : [];
    const organiserNotices: NewNotification[] = [];
    if (changeRequest) {
      await tx
        .update(eventChangeRequests)
        .set({
          outcome: "applied",
          processedById: actor.id,
          processedByName: actorName,
          processedAt: appliedAt,
        })
        .where(eq(eventChangeRequests.id, changeRequest.id));
      organiserNotices.push({
        recipientId: request.organiserId,
        eventRequestId: request.id,
        kind: "event_change_processed",
        payload: {
          outcome: "applied",
          eventName: values.eventName.trim() || "Untitled request",
          whatShouldChange: changeRequest.whatShouldChange,
        },
      });
    }
    await raiseNotifications(tx, [...notices, ...organiserNotices]);

    // The toast counts the holders told (PTR-23 AC5); the Organiser's notice is not one of them.
    return { changedFields: changes.map(change => change.field), notified: notices.length };
  });
}

/**
 * The event row, locked, and the waiting change request this save applies, if any. A direct edit
 * (PTR-22) is refused outside approved, planning and confirmed; an apply (PTR-52) is open wherever
 * the request could be raised, and refuses a closed event with the request's own message. A missing
 * event and someone else's event are refused the same way, so the refusal does not say whether the
 * id exists. A draft has no Coordinator, so it is refused here too.
 */
async function lockForUpdate(
  tx: Tx,
  input: ReturnType<typeof parseEventInformationInput>,
  actor: SessionUser
) {
  if (input.changeRequestId !== undefined) {
    const { event, changeRequest } = await lockWaitingChangeRequest(
      tx,
      input.id,
      input.changeRequestId,
      actor
    );
    if (!canApplyEventChangeRequest(event.status)) {
      throw new ConflictError(EVENT_CHANGE_REQUEST_CLOSED);
    }
    return { request: event, changeRequest };
  }

  const request = (
    await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
  ).at(0);
  if (!request || request.assignedCoordinatorId !== actor.id) {
    throw new AuthorizationError("Forbidden");
  }
  if (!canUpdateEventInformation(request.status)) {
    throw new ConflictError(
      `This event's information cannot be updated while its status is ${EVENT_REQUEST_STATUS_LABELS[request.status].toLowerCase()}.`
    );
  }
  return { request, changeRequest: null };
}

/**
 * PTR-52: the waiting change request named by `changeRequestId`, locked, on an event the actor is
 * the assigned Coordinator of, also locked. The event lock goes first, as every writer on the event
 * takes it, so an apply, a decline and a cancellation serialise. A missing event, a draft and
 * someone else's event are refused the same way; a request that is not this event's or is already
 * processed answers 409, so a double click or a stale page cannot process it twice.
 */
async function lockWaitingChangeRequest(
  tx: Tx,
  eventId: number,
  changeRequestId: number,
  actor: SessionUser
) {
  const event = (
    await tx.select().from(eventRequests).where(eq(eventRequests.id, eventId)).for("update")
  ).at(0);
  if (!event || event.status === "draft" || event.assignedCoordinatorId !== actor.id) {
    throw new AuthorizationError("Forbidden");
  }
  const changeRequest = (
    await tx
      .select()
      .from(eventChangeRequests)
      .where(
        and(
          eq(eventChangeRequests.id, changeRequestId),
          eq(eventChangeRequests.eventRequestId, event.id)
        )
      )
      .for("update")
  ).at(0);
  if (!changeRequest || changeRequest.outcome !== null) {
    throw new ConflictError(CHANGE_REQUEST_NOT_WAITING_MESSAGE);
  }
  return { event, changeRequest };
}

/**
 * PTR-52 AC2, AC5: the assigned Coordinator declines a waiting change request with a reason. The
 * event is left as it is in every status, as a cancellation request is; the request keeps its
 * outcome and reason on the record, and the Organiser is told in the same transaction.
 */
export async function handleDeclineEventChangeRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseEventChangeRequestDeclineInput(data);

  return database.transaction(async tx => {
    const { event, changeRequest } = await lockWaitingChangeRequest(
      tx,
      input.id,
      input.changeRequestId,
      actor
    );

    const [declined] = await tx
      .update(eventChangeRequests)
      .set({
        outcome: "declined",
        declineReason: input.reason,
        processedById: actor.id,
        processedByName: actor.name?.trim() || actor.email,
        processedAt: new Date(),
      })
      .where(eq(eventChangeRequests.id, changeRequest.id))
      .returning();
    await raiseNotifications(tx, [
      {
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_change_processed",
        payload: {
          outcome: "declined",
          eventName: event.eventName.trim() || "Untitled request",
          whatShouldChange: changeRequest.whatShouldChange,
          reason: input.reason,
        },
      },
    ]);

    return declined;
  });
}

/**
 * PTR-23 AC5: the Venue Staff on each approved booking and each Technical Support member holding
 * a reservation are told which significant fields changed. The Venue Staff copy names the booking,
 * never the event (PTR-8). A tentative hold is the Coordinator's own and names no one. The rows
 * commit with the update; the worker sends the emails.
 */
async function significantChangeNotices(
  tx: Tx,
  event: { id: number; eventName: string },
  changedFields: SignificantField[],
  actorName: string
): Promise<NewNotification[]> {
  const { bookings, reservationStaffIds } = await loadArrangementHolders(tx, event.id);

  const notices: NewNotification[] = [];
  for (const { staffId, venueName, startsAt, endsAt } of bookings) {
    notices.push({
      recipientId: staffId,
      eventRequestId: event.id,
      kind: "event_significant_change",
      payload: {
        audience: "venue_staff",
        venueName,
        startsAt,
        endsAt,
        changedFields,
        actorName,
      },
    });
  }
  for (const staffId of reservationStaffIds) {
    notices.push({
      recipientId: staffId,
      eventRequestId: event.id,
      kind: "event_significant_change",
      payload: {
        audience: "technical_support",
        eventName: event.eventName.trim() || "Untitled event",
        changedFields,
        actorName,
      },
    });
  }
  return notices;
}
