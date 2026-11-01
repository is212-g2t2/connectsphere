import { asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventInformationChanges } from "#/db/schema";

type Database = typeof Db;

/**
 * Return an event's information-change log in the order it was written (PTR-22 AC4). Both the
 * Organiser and the Coordinator pages show it, so the projection omits the changer's id.
 * PTR-164 AC3: each row carries the significant-change reason, repeated per changed field.
 */
export async function listEventInformationChanges(
  eventRequestId: number,
  database: Pick<Database, "select">
) {
  return database
    .select({
      id: eventInformationChanges.id,
      field: eventInformationChanges.field,
      amendment: eventInformationChanges.amendment,
      changedByName: eventInformationChanges.changedByName,
      changedAt: eventInformationChanges.changedAt,
      reason: eventInformationChanges.reason,
    })
    .from(eventInformationChanges)
    .where(eq(eventInformationChanges.eventRequestId, eventRequestId))
    .orderBy(asc(eventInformationChanges.changedAt), asc(eventInformationChanges.id));
}
