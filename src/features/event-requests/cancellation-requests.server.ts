import { and, asc, eq, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventCancellationRequests } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { lockOwnedEvent } from "#/features/event-requests/owned-event.server";
import {
  EVENT_CANCELLATION_ALREADY_REQUESTED,
  EVENT_CANCELLATION_CLOSED,
  canRequestEventCancellation,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";

type Database = typeof Db;

/**
 * PTR-53/54: an event's cancellation requests with their outcomes, in the order they were raised.
 * The Organiser's page and the Coordinator's page both show them.
 */
export async function listEventCancellationRequests(
  eventRequestId: number,
  database: Pick<Database, "select">
) {
  return database
    .select({
      id: eventCancellationRequests.id,
      createdAt: eventCancellationRequests.createdAt,
      outcome: eventCancellationRequests.outcome,
      declineReason: eventCancellationRequests.declineReason,
      processedByName: eventCancellationRequests.processedByName,
      processedAt: eventCancellationRequests.processedAt,
    })
    .from(eventCancellationRequests)
    .where(eq(eventCancellationRequests.eventRequestId, eventRequestId))
    .orderBy(asc(eventCancellationRequests.createdAt), asc(eventCancellationRequests.id));
}

/**
 * PTR-53: the Organiser asks for their event to be cancelled. Only the request is recorded; the
 * event's status waits for the Coordinator (AC4). The event row lock serialises the request with
 * a completion or a cancellation, and with a second request, which the open-request index also
 * refuses. An assigned Coordinator is notified in the same transaction; an unassigned event stays
 * in the unassigned list, where any Coordinator sees it (AC3).
 */
export async function handleRequestEventCancellation(
  data: unknown,
  organiser: SessionUser,
  database: Database
) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const event = await lockOwnedEvent(tx, input.id, organiser.id);
    if (!canRequestEventCancellation(event.status)) {
      throw new ConflictError(EVENT_CANCELLATION_CLOSED);
    }

    const waiting = await tx
      .select({ id: eventCancellationRequests.id })
      .from(eventCancellationRequests)
      .where(
        and(
          eq(eventCancellationRequests.eventRequestId, event.id),
          isNull(eventCancellationRequests.outcome)
        )
      );
    if (waiting.length > 0) throw new ConflictError(EVENT_CANCELLATION_ALREADY_REQUESTED);

    const [request] = await tx
      .insert(eventCancellationRequests)
      .values({ eventRequestId: event.id, organiserId: organiser.id })
      .returning();

    if (event.assignedCoordinatorId !== null) {
      await raiseNotifications(tx, [
        {
          recipientId: event.assignedCoordinatorId,
          eventRequestId: event.id,
          kind: "event_cancellation_requested",
          payload: { eventName: event.eventName.trim() || "Untitled request" },
        },
      ]);
    }

    return request;
  });
}
