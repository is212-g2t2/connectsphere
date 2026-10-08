import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventInformationChanges, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { amendedValues, amendmentsBetween } from "#/features/event-requests/amendments";
import {
  EVENT_INFORMATION_FIELDS,
  EVENT_REQUEST_STATUS_LABELS,
  SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE,
  canUpdateEventInformation,
  parseEventInformationInput,
  significantFields,
} from "#/features/event-requests/schema";
import type { ClarificationField, SignificantField } from "#/features/event-requests/schema";
import { loadArrangementHolders } from "#/features/events/arrangements.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

// Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
// reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
// pipeline has already verified the session and `event_request:coordinate`.

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface EventInformationUpdated {
  changedFields: ClarificationField[];
  /** PTR-23 AC5: how many staff holding an arrangement were told; 0 for an ordinary edit. */
  notified: number;
}

/**
 * PTR-22 AC2/AC4: the assigned Coordinator updates an approved, planning or confirmed event. The
 * event row is locked first, and the amendments are written over the locked values, so a field
 * the Coordinator did not touch keeps its stored value. Each changed field gets one change-log
 * row, in the same transaction as the update. A save that changes nothing writes nothing. Every
 * view reads the row live, so the next read shows the new values (AC3).
 *
 * PTR-23: a significant change (AC1) is refused until the Coordinator acknowledges the warning
 * that names what the event holds (AC2), and once saved it tells the staff holding a booking or a
 * reservation (AC5). The arrangements themselves are not touched (AC3).
 */
export async function handleUpdateEventInformation(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<EventInformationUpdated> {
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
    if (changes.length === 0) return { changedFields: [], notified: 0 };

    // Decided on what actually changed, not on what the form touched: a field typed over and
    // restored is no change. The refusal rolls the locked row back untouched.
    const significant = significantFields(changes.map(change => change.field));
    if (significant.length > 0 && input.acknowledgeSignificant !== true) {
      throw new ConflictError(SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE);
    }

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
    const actorName = actor.name?.trim() || actor.email;
    await tx.insert(eventInformationChanges).values(
      changes.map(({ field, from, to }) => ({
        eventRequestId: request.id,
        field,
        amendment: { from, to },
        changedById: actor.id,
        changedByName: actorName,
        // `now()` defaults to the transaction timestamp, which predates a wait on the row lock,
        // so overlapping saves could be logged out of order.
        changedAt: appliedAt,
      }))
    );

    // The event's name as it now is, so a notice never names an event by a name the same save
    // replaced.
    const notices =
      significant.length > 0
        ? await significantChangeNotices(
            tx,
            { id: request.id, eventName: values.eventName },
            significant,
            actorName
          )
        : [];
    await raiseNotifications(tx, notices);

    return { changedFields: changes.map(change => change.field), notified: notices.length };
  });
}

/**
 * PTR-23 AC5: the Venue Staff on each approved booking and each Technical Support member holding
 * a reservation are told which significant fields changed. The Venue Staff copy names the booking,
 * never the event (PTR-8). A tentative hold is the Coordinator's own and names no one. The rows
 * commit with the update; the worker sends the emails.
 */
async function significantChangeNotices(
  tx: Tx,
  event: { id: number; eventName: string },
  changedFields: SignificantField[],
  actorName: string
): Promise<NewNotification[]> {
  const { bookings, reservationStaffIds } = await loadArrangementHolders(tx, event.id);

  const notices: NewNotification[] = [];
  for (const { staffId, venueName, startsAt, endsAt } of bookings) {
    notices.push({
      recipientId: staffId,
      eventRequestId: event.id,
      kind: "event_significant_change",
      payload: {
        audience: "venue_staff",
        venueName,
        startsAt,
        endsAt,
        changedFields,
        actorName,
      },
    });
  }
  for (const staffId of reservationStaffIds) {
    notices.push({
      recipientId: staffId,
      eventRequestId: event.id,
      kind: "event_significant_change",
      payload: {
        audience: "technical_support",
        eventName: event.eventName.trim() || "Untitled event",
        changedFields,
        actorName,
      },
    });
  }
  return notices;
}
