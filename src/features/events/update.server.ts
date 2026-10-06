import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventInformationChanges, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { amendmentsBetween } from "#/features/event-requests/amendments";
import {
  CLARIFICATION_FIELDS,
  canUpdateEventInformation,
  eventInformationLockedMessage,
  parseEventInformationInput,
} from "#/features/event-requests/schema";
import type { ClarificationField } from "#/features/event-requests/schema";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event_request:coordinate`.
 */

type Database = typeof Db;

const EVENT_INFORMATION_FIELDS = CLARIFICATION_FIELDS.map(field => field.key);

/**
 * PTR-22 AC2/AC4: the assigned Coordinator updates an approved, planning or confirmed event. The
 * event row is locked first, so the diff and the change log are measured against the stored
 * values. Each changed field gets one change-log row, in the same transaction as the update. A
 * save that changes nothing writes nothing. Every view reads the row live, so the next read
 * shows the new values (AC3).
 */
export async function handleUpdateEventInformation(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<{ changedFields: ClarificationField[] }> {
  const { id, ...values } = parseEventInformationInput(data);

  return database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, id)).for("update")
    ).at(0);

    // A missing event and someone else's event are refused the same way, so the refusal does not
    // say whether the id exists.
    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }
    if (!canUpdateEventInformation(request.status)) {
      throw new ConflictError(eventInformationLockedMessage(request.status));
    }

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

    await tx.insert(eventInformationChanges).values(
      changes.map(change => ({
        eventRequestId: request.id,
        field: change.field,
        previousValue: change.from,
        newValue: change.to,
        changedById: actor.id,
        changedByName: actor.name?.trim() || actor.email,
      }))
    );

    return { changedFields: changes.map(change => change.field) };
  });
}
