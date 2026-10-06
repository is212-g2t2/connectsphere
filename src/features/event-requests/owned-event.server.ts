import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests } from "#/db/schema";
import { AuthorizationError } from "#/features/auth/session";

type Database = typeof Db;
type EventTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-51/53: locks the Organiser's own event row until the transaction ends, so a concurrent
 * completion or cancellation cannot pass the caller's eligibility check and commit beside the
 * caller's write. Another Organiser's event and an unknown id are refused the same way.
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
