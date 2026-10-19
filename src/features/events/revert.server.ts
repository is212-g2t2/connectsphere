import { and, eq, inArray } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests } from "#/db/schema";

type Database = typeof Db;

/** Revert only confirmed events and return the rows this transaction changed. */
export async function revertConfirmedEvents(
  tx: Pick<Database, "update">,
  eventIds: readonly number[]
): Promise<Set<number>> {
  if (eventIds.length === 0) return new Set();
  const rows = await tx
    .update(eventRequests)
    .set({ status: "planning", confirmedById: null, confirmedByName: null, confirmedAt: null })
    .where(and(inArray(eventRequests.id, [...eventIds]), eq(eventRequests.status, "confirmed")))
    .returning({ id: eventRequests.id });
  return new Set(rows.map(row => row.id));
}
