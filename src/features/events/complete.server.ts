import { and, desc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, venueRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { eventTiming } from "#/features/events/access";
import {
  COMPLETION_REFUSAL_HEADING,
  completionRefusal,
  singaporeLocalEndHasPassed,
} from "#/features/events/completion";

type Database = typeof Db;

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
          endsAt: venueRequests.endsAt,
        })
        .from(venueRequests)
        .where(and(eq(venueRequests.eventId, request.id), eq(venueRequests.status, "approved")))
        .orderBy(desc(venueRequests.endsAt))
        .limit(1)
    ).at(0);
    const { endDate: eventEnd, endTime: eventEndTime } = eventTiming(request.proposedDates);
    const refusal = completionRefusal({
      status: request.status,
      approvedBookingHasEnded: singaporeLocalEndHasPassed(latestApprovedBooking?.endsAt ?? null),
      eventHasEnded: singaporeLocalEndHasPassed(
        eventEnd && eventEndTime ? `${eventEnd}T${eventEndTime}` : null
      ),
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
