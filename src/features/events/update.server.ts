import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventInformationChanges, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { amendedValues, amendmentsBetween } from "#/features/event-requests/amendments";
import {
  EVENT_INFORMATION_FIELDS,
  EVENT_REQUEST_STATUS_LABELS,
  canUpdateEventInformation,
  parseEventInformationInput,
} from "#/features/event-requests/schema";
import type { ClarificationField } from "#/features/event-requests/schema";

// Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
// reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
// pipeline has already verified the session and `event_request:coordinate`.

type Database = typeof Db;

/**
 * PTR-22 AC2/AC4: the assigned Coordinator updates an approved, planning or confirmed event. The
 * event row is locked first, and the amendments are written over the locked values, so a field
 * the Coordinator did not touch keeps its stored value. Each changed field gets one change-log
 * row, in the same transaction as the update. A save that changes nothing writes nothing. Every
 * view reads the row live, so the next read shows the new values (AC3).
 */
export async function handleUpdateEventInformation(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<{ changedFields: ClarificationField[] }> {
  const input = parseEventInformationInput(data);

  return database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    // A missing event and someone else's event are refused the same way, so the refusal does not
    // say whether the id exists. A draft has no Coordinator, so it is refused here too.
    if (!request || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }
    if (!canUpdateEventInformation(request.status)) {
      throw new ConflictError(
        `This event's information cannot be updated while its status is ${EVENT_REQUEST_STATUS_LABELS[request.status].toLowerCase()}.`
      );
    }

    const values = amendedValues(request, input.amendments);
    const changes = amendmentsBetween(request, values, EVENT_INFORMATION_FIELDS);
    if (changes.length === 0) return { changedFields: [] };

    await tx
      .update(eventRequests)
      .set({
        ...values,
        expectedAttendance: values.expectedAttendance ?? null,
        registrationCapacity: values.registrationCapacity ?? null,
        registrationOpensAt: values.registrationOpensAt ?? null,
        registrationClosesAt: values.registrationClosesAt ?? null,
      })
      .where(eq(eventRequests.id, request.id));

    const appliedAt = new Date();
    await tx.insert(eventInformationChanges).values(
      changes.map(({ field, from, to }) => ({
        eventRequestId: request.id,
        field,
        amendment: { from, to },
        changedById: actor.id,
        changedByName: actor.name?.trim() || actor.email,
        // `now()` defaults to the transaction timestamp, which predates a wait on the row lock,
        // so overlapping saves could be logged out of order.
        changedAt: appliedAt,
      }))
    );

    return { changedFields: changes.map(change => change.field) };
  });
}
