import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests } from "#/db/schema";
import { AuthorizationError } from "#/features/auth/session";

type Database = typeof Db;
type EventTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-51/53: Lock the Organiser's own event row until the transaction ends. This stops a
 * concurrent completion or cancellation from passing the eligibility check and committing beside
 * this write. Refuse another Organiser's event and an unknown id in the same way.
 */
export async function lockOwnedEvent(tx: EventTx, eventRequestId: number, organiserId: string) {
  const event = (
    await tx
      .select({
        id: eventRequests.id,
        eventName: eventRequests.eventName,
        assignedCoordinatorId: eventRequests.assignedCoordinatorId,
        status: eventRequests.status,
      })
      .from(eventRequests)
      .where(and(eq(eventRequests.id, eventRequestId), eq(eventRequests.organiserId, organiserId)))
      .for("update")
  ).at(0);

  if (!event) throw new AuthorizationError("Forbidden");
  return event;
}
