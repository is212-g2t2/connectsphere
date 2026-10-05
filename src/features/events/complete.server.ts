import { and, desc, eq, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, venueRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { EVENT_REQUEST_STATUS_LABELS, parseEventRequestId } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import {
  COMPLETION_REFUSAL_HEADING,
  EVENT_HAS_NOT_ENDED_MESSAGE,
  NO_APPROVED_BOOKING_MESSAGE,
} from "#/features/events/completion";

type Database = typeof Db;

interface CompletionInput {
  status: EventRequestStatus;
  approvedBookingHasEnded: boolean | null;
}

/** One refusal for the completion attempt, or null when it may proceed. */
export function completionRefusal(input: CompletionInput): string | null {
  if (input.status !== "confirmed") {
    return `Its status is ${EVENT_REQUEST_STATUS_LABELS[input.status].toLowerCase()}.`;
  }
  if (input.approvedBookingHasEnded === null) return NO_APPROVED_BOOKING_MESSAGE;
  return input.approvedBookingHasEnded ? null : EVENT_HAS_NOT_ENDED_MESSAGE;
}

/**
 * PTR-25: the assigned Coordinator explicitly completes an ended confirmed event. The event row
 * lock serialises the transition with new booking approvals and equipment reservations, whose
 * key-share locks then re-read the completed status before they write.
 */
export async function handleCompleteEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }

    const latestApprovedBooking = (
      await tx
        .select({
          hasEnded: sql<boolean>`${venueRequests.endsAt} < timezone('Asia/Singapore', now())`,
        })
        .from(venueRequests)
        .where(and(eq(venueRequests.eventId, request.id), eq(venueRequests.status, "approved")))
        .orderBy(desc(venueRequests.endsAt))
        .limit(1)
    ).at(0);
    const refusal = completionRefusal({
      status: request.status,
      approvedBookingHasEnded: latestApprovedBooking?.hasEnded ?? null,
    });
    if (refusal) throw new ConflictError(`${COMPLETION_REFUSAL_HEADING}\n- ${refusal}`);

    const completedAt = new Date();
    const [completed] = await tx
      .update(eventRequests)
      .set({
        status: "completed",
        completedById: actor.id,
        completedByName: actor.name,
        completedAt,
      })
      .where(eq(eventRequests.id, request.id))
      .returning();

    return completed;
  });
}
