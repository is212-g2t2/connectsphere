import { asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventChangeRequests } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { lockOwnedEvent } from "#/features/event-requests/owned-event.server";
import {
  canRaiseEventChangeRequest,
  parseEventChangeRequestInput,
} from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";

type Database = typeof Db;

const EVENT_CHANGE_REQUEST_CLOSED = "This event can no longer be changed.";

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
