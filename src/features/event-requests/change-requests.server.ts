import { asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventChangeRequests } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { lockOwnedEvent } from "#/features/event-requests/owned-event.server";
import {
  EVENT_CHANGE_REQUEST_CLOSED,
  canRaiseEventChangeRequest,
  parseEventChangeRequestInput,
} from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";

type Database = typeof Db;

/**
 * Return change requests in the order the Organiser raised them, with their outcomes (PTR-51/52).
 * Both the Organiser and Coordinator pages show them, so the projection omits the processor's id.
 */
export async function listEventChangeRequests(
  eventRequestId: number,
  database: Pick<Database, "select">
) {
  return database
    .select({
      id: eventChangeRequests.id,
      whatShouldChange: eventChangeRequests.whatShouldChange,
      requestedValue: eventChangeRequests.requestedValue,
      createdAt: eventChangeRequests.createdAt,
      outcome: eventChangeRequests.outcome,
      declineReason: eventChangeRequests.declineReason,
      processedByName: eventChangeRequests.processedByName,
      processedAt: eventChangeRequests.processedAt,
    })
    .from(eventChangeRequests)
    .where(eq(eventChangeRequests.eventRequestId, eventRequestId))
    .orderBy(asc(eventChangeRequests.createdAt), asc(eventChangeRequests.id));
}

/**
 * Record an owned request after submission without changing an `event_requests` field. The row
 * lock prevents completion or cancellation from passing the eligibility check at the same time.
 * Notify an assigned Coordinator in the same transaction. Unassigned events remain in the queue.
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
