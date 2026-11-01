import { and, eq, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventCancellationRequests, eventChangeRequests, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  parseEventAttendanceInput,
  parseEventCompleteInput,
} from "#/features/event-requests/schema";
import {
  COMPLETION_REFUSAL_HEADING,
  EVENT_COMPLETED_CLOSEOUT_REASON,
  closeOutProcessorName,
  completionRefusalForEvent,
} from "#/features/events/completion";
import { raiseNotifications } from "#/features/notifications/raise.server";

type Database = typeof Db;

/**
 * PTR-25: The assigned Coordinator explicitly completes an ended, confirmed event. The event row
 * lock orders this transition against the write paths. Those paths share the lock and re-read
 * the completed status.
 *
 * PTR-156: the same transaction declines every waiting change and cancellation request. The
 * completing Coordinator is the processor, and the Organiser gets the existing decline notice
 * for each.
 */
export async function handleCompleteEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventCompleteInput(data);

  return database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    // Refuse a missing event and another user's event in the same way. The refusal then reveals
    // nothing about the id.
    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }

    const refusal = completionRefusalForEvent(request);
    if (refusal) throw new ConflictError(`${COMPLETION_REFUSAL_HEADING}\n- ${refusal}`);

    const completedAt = new Date();
    const [completed] = await tx
      .update(eventRequests)
      .set({
        status: "completed",
        completedById: actor.id,
        completedByName: actor.name?.trim() || actor.email,
        completedAt,
        actualAttendance: input.actualAttendance ?? null,
      })
      .where(eq(eventRequests.id, request.id))
      .returning();

    // Nothing can still wait on a completed event. Decline what waits so the queue holds only
    // requests the Coordinator can still act on.
    const processorName = closeOutProcessorName(actor);
    const staleChanges = await tx
      .update(eventChangeRequests)
      .set({
        outcome: "declined",
        declineReason: EVENT_COMPLETED_CLOSEOUT_REASON,
        processedById: actor.id,
        processedByName: processorName,
        processedAt: completedAt,
      })
      .where(
        and(eq(eventChangeRequests.eventRequestId, request.id), isNull(eventChangeRequests.outcome))
      )
      .returning({ whatShouldChange: eventChangeRequests.whatShouldChange });
    const staleCancellations = await tx
      .update(eventCancellationRequests)
      .set({
        outcome: "declined",
        declineReason: EVENT_COMPLETED_CLOSEOUT_REASON,
        processedById: actor.id,
        processedByName: processorName,
        processedAt: completedAt,
      })
      .where(
        and(
          eq(eventCancellationRequests.eventRequestId, request.id),
          isNull(eventCancellationRequests.outcome)
        )
      )
      .returning({ id: eventCancellationRequests.id });

    const name = request.eventName.trim() || "Untitled event";
    await raiseNotifications(tx, [
      ...staleChanges.map(change => ({
        recipientId: request.organiserId,
        eventRequestId: request.id,
        kind: "event_change_processed" as const,
        payload: {
          outcome: "declined" as const,
          eventName: name,
          whatShouldChange: change.whatShouldChange,
          reason: EVENT_COMPLETED_CLOSEOUT_REASON,
        },
      })),
      ...staleCancellations.map(() => ({
        recipientId: request.organiserId,
        eventRequestId: request.id,
        kind: "event_cancellation_declined" as const,
        payload: {
          eventName: name,
          reason: EVENT_COMPLETED_CLOSEOUT_REASON,
          closeOut: true,
          eventStatus: "completed" as const,
        },
      })),
    ]);

    return completed;
  });
}

/** PTR-157 AC3: only a completed event takes a turnout correction. */
export const ATTENDANCE_NOT_COMPLETED_MESSAGE =
  "Actual attendance can only be updated on a completed event.";

/**
 * PTR-157 AC3: the assigned Coordinator sets or corrects the turnout on a completed event.
 * The row lock orders this write against the other event writers. The status stays completed;
 * only the count changes. The general information edit stays closed for completed events, so
 * this dedicated handler is the one path that writes the count after close-out.
 */
export async function handleUpdateEventAttendance(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseEventAttendanceInput(data);

  return database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    // Refuse a missing event and another user's event in the same way, as the completion does.
    // A draft holds no assignment, so the assignment check refuses it.
    if (!request || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }
    if (request.status !== "completed") {
      throw new ConflictError(ATTENDANCE_NOT_COMPLETED_MESSAGE);
    }

    // Return the display fields alone. The browser needs no other column of the row.
    const [updated] = await tx
      .update(eventRequests)
      .set({ actualAttendance: input.actualAttendance ?? null })
      .where(eq(eventRequests.id, request.id))
      .returning({
        id: eventRequests.id,
        status: eventRequests.status,
        actualAttendance: eventRequests.actualAttendance,
      });

    return updated;
  });
}
