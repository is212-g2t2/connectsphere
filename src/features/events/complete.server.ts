import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import {
  COMPLETION_REFUSAL_HEADING,
  completionRefusalForEvent,
} from "#/features/events/completion";

type Database = typeof Db;

/**
 * PTR-25: the assigned Coordinator explicitly completes an ended confirmed event. The event row
 * lock serialises the transition with the write paths, which key-share and re-read the
 * completed status.
 */
export async function handleCompleteEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    // A missing event and someone else's event are refused the same way, so the refusal does not
    // say whether the id exists.
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
      })
      .where(eq(eventRequests.id, request.id))
      .returning();

    return completed;
  });
}
