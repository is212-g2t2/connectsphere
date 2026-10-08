import { and, asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventChangeRequests, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { lockOwnedEvent } from "#/features/event-requests/owned-event.server";
import {
  CHANGE_REQUEST_NOT_WAITING_MESSAGE,
  EVENT_CHANGE_REQUEST_CLOSED,
  canRaiseEventChangeRequest,
  parseEventChangeRequestDeclineInput,
  parseEventChangeRequestInput,
} from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** PTR-51: read the append-only requests in the order the Organiser raised them. */
export async function listEventChangeRequests(
  eventRequestId: number,
  database: Pick<Database, "select">
) {
  return database
    .select()
    .from(eventChangeRequests)
    .where(eq(eventChangeRequests.eventRequestId, eventRequestId))
    .orderBy(asc(eventChangeRequests.createdAt), asc(eventChangeRequests.id));
}

/**
 * Records an owned post-submission request without writing any `event_requests` field. The row lock
 * keeps a concurrent completion or cancellation from passing the eligibility check and committing
 * beside the new request. An assigned Coordinator receives a notification in the same transaction;
 * an unassigned event already remains visible in the unassigned queue.
 */
export async function handleRaiseEventChangeRequest(
  data: unknown,
  organiser: SessionUser,
  database: Database
) {
  const input = parseEventChangeRequestInput(data);

  return database.transaction(async tx => {
    const event = await lockOwnedEvent(tx, input.id, organiser.id);
    if (!canRaiseEventChangeRequest(event.status)) {
      throw new ConflictError(EVENT_CHANGE_REQUEST_CLOSED);
    }

    const [changeRequest] = await tx
      .insert(eventChangeRequests)
      .values({
        eventRequestId: event.id,
        organiserId: organiser.id,
        whatShouldChange: input.whatShouldChange,
        requestedValue: input.requestedValue,
      })
      .returning();

    if (event.assignedCoordinatorId !== null) {
      await raiseNotifications(tx, [
        {
          recipientId: event.assignedCoordinatorId,
          eventRequestId: event.id,
          kind: "event_change_requested",
          payload: {
            eventName: event.eventName.trim() || "Untitled request",
            whatShouldChange: input.whatShouldChange,
            requestedValue: input.requestedValue,
          },
        },
      ]);
    }

    return changeRequest;
  });
}

/**
 * PTR-52: the waiting change request named by `changeRequestId`, locked, on an event the actor is
 * the assigned Coordinator of, also locked. The event lock goes first, as every writer on the event
 * takes it, so an apply, a decline and a cancellation serialise. A missing event, a draft and
 * someone else's event are refused the same way; a request that is not this event's or is already
 * processed answers 409 so a double click or a stale page cannot process it twice.
 */
export async function lockWaitingChangeRequest(
  tx: Tx,
  eventId: number,
  changeRequestId: number,
  actor: SessionUser
) {
  const event = (
    await tx.select().from(eventRequests).where(eq(eventRequests.id, eventId)).for("update")
  ).at(0);
  if (!event || event.assignedCoordinatorId !== actor.id) {
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
