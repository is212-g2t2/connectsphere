import { and, eq, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventChangeRequests, eventInformationChanges, eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { amendedValues, amendmentsBetween } from "#/features/event-requests/amendments";
import {
  CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE,
  CHANGE_REQUEST_NOT_WAITING_MESSAGE,
  EVENT_CHANGE_REQUEST_CLOSED,
  EVENT_INFORMATION_FIELDS,
  EVENT_REQUEST_STATUS_LABELS,
  SIGNIFICANT_CHANGE_REASON_REQUIRED_MESSAGE,
  SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE,
  canApplyEventChangeRequest,
  canUpdateEventInformation,
  parseEventChangeRequestDeclineInput,
  parseEventInformationInput,
  significantFields,
} from "#/features/event-requests/schema";
import type { ClarificationField, SignificantField } from "#/features/event-requests/schema";
import { loadArrangementHolders } from "#/features/events/arrangements.server";
import { announcePlaceAvailable, readPlaceState } from "#/features/events/register.server";
import { didFreePlace } from "#/features/events/registration";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

// Keep this module server-only. It imports `#/db/schema` as a value. `server-fns.ts` loads it
// dynamically inside `.handler()`. Middleware already verified the session and
// `event_request:coordinate`.

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface EventInformationUpdated {
  changedFields: ClarificationField[];
  /** PTR-23 AC5: Notice count for staff with an arrangement. Ordinary edits report 0. */
  notified: number;
}

/**
 * PTR-22 AC2/AC4: The assigned Coordinator updates an approved, planning, or confirmed event.
 * Lock the event row first. Write amendments over the locked values, so untouched fields keep
 * their stored values. Write one change-log row per changed field in the same transaction. A
 * save with no changes writes nothing. Every view reads the row live, so the next read shows
 * the new values (AC3).
 *
 * PTR-23: Refuse a significant change (AC1) until the Coordinator acknowledges the warning that
 * names what the event holds (AC2). After save, tell the staff with a booking or reservation
 * (AC5). Touch no arrangement (AC3).
 *
 * PTR-52: A save with `changeRequestId` applies the Organiser's waiting change request. It stays
 * open in every status where a request can be raised. It must change something. Mark the request
 * applied and tell the Organiser in the same transaction (AC2, AC5). Move nothing else (AC4).
 *
 * PTR-164 AC2, AC3: a significant save needs a reason, stored on the change log and carried on the
 * notices. The Organiser receives a significant-change notice too; when the save applies their own
 * request, the reason goes on the processed notice instead, so they get one notice.
 */
export async function handleUpdateEventInformation(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<EventInformationUpdated> {
  const input = parseEventInformationInput(data);

  return database.transaction(async tx => {
    let request: typeof eventRequests.$inferSelect;
    let changeRequest: typeof eventChangeRequests.$inferSelect | null;
    if (input.changeRequestId !== undefined) {
      const locked = await lockWaitingChangeRequest(tx, input.id, input.changeRequestId, actor);
      if (!canApplyEventChangeRequest(locked.event.status)) {
        throw new ConflictError(EVENT_CHANGE_REQUEST_CLOSED);
      }
      request = locked.event;
      changeRequest = locked.changeRequest;
    } else {
      const direct = (
        await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
      ).at(0);
      if (!direct || direct.assignedCoordinatorId !== actor.id) {
        throw new AuthorizationError("Forbidden");
      }
      if (!canUpdateEventInformation(direct.status)) {
        throw new ConflictError(
          `This event's information cannot be updated while its status is ${EVENT_REQUEST_STATUS_LABELS[direct.status].toLowerCase()}.`
        );
      }
      request = direct;
      changeRequest = null;
    }

    const values = amendedValues(request, input.amendments);
    const changes = amendmentsBetween(request, values, EVENT_INFORMATION_FIELDS);
    if (changes.length === 0) {
      // An apply must change the record. Refuse a no-change save so the request stays waiting.
      if (changeRequest) throw new ConflictError(CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE);
      return { changedFields: [], notified: 0 };
    }

    // Decide on what changed, not on what the form touched. A field typed over and restored is
    // no change. The refusal leaves the locked row untouched.
    const significant = significantFields(changes.map(change => change.field));
    if (significant.length > 0 && input.acknowledgeSignificant !== true) {
      throw new ConflictError(SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE);
    }
    const reason = significant.length > 0 ? (input.reason?.trim() ?? "") : "";
    if (significant.length > 0 && reason === "") {
      throw new Error(SIGNIFICANT_CHANGE_REASON_REQUIRED_MESSAGE);
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

    // A raised registration capacity can open a place for the waiting list. The counts stay
    // the same; only the ceiling moves.
    if (
      typeof values.registrationCapacity === "number" &&
      typeof request.registrationCapacity === "number" &&
      values.registrationCapacity > request.registrationCapacity
    ) {
      const before = await readPlaceState(tx, request.id, request.registrationCapacity);
      if (didFreePlace(before, { ...before, registrationCapacity: values.registrationCapacity })) {
        await announcePlaceAvailable(tx, request.id, values.eventName.trim() || "Untitled event");
      }
    }

    const appliedAt = new Date();
    const actorName = actor.name?.trim();
    await tx.insert(eventInformationChanges).values(
      changes.map(({ field, from, to }) => ({
        eventRequestId: request.id,
        field,
        amendment: { from, to },
        changedById: actor.id,
        changedByName: actorName || actor.email,
        // `now()` defaults to the transaction timestamp. It predates a wait on the row lock, so
        // overlapping saves could log out of order.
        changedAt: appliedAt,
        reason: significant.length > 0 ? reason : null,
      }))
    );

    // Use the event's current name. A notice must not use a name this save replaced.
    const staff =
      significant.length > 0
        ? await significantChangeNotices(
            tx,
            { id: request.id, eventName: values.eventName },
            significant,
            // Send a role word, not the address. The notice goes to staff outside the event's team.
            actorName || "The Coordinator",
            reason
          )
        : [];
    const eventName = values.eventName.trim() || "Untitled request";
    if (changeRequest) {
      const applied = await tx
        .update(eventChangeRequests)
        .set({
          outcome: "applied",
          processedById: actor.id,
          processedByName: actorName || actor.email,
          processedAt: appliedAt,
        })
        .where(
          and(eq(eventChangeRequests.id, changeRequest.id), isNull(eventChangeRequests.outcome))
        )
        .returning({ id: eventChangeRequests.id });
      if (applied.length === 0) throw new ConflictError(CHANGE_REQUEST_NOT_WAITING_MESSAGE);
    }
    // A significant apply carries the reason on the processed notice, so the Organiser gets one
    // notice. Any other significant save sends the Organiser their own significant-change copy.
    const organiserNotice: NewNotification[] =
      significant.length === 0
        ? []
        : changeRequest
          ? []
          : [
              {
                recipientId: request.organiserId,
                eventRequestId: request.id,
                kind: "event_significant_change",
                payload: {
                  audience: "organiser",
                  eventName,
                  changedFields: significant,
                  actorName: actorName || "The Coordinator",
                  reason,
                },
              },
            ];
    await raiseNotifications(
      tx,
      changeRequest
        ? [
            ...staff,
            {
              recipientId: request.organiserId,
              eventRequestId: request.id,
              kind: "event_change_processed",
              payload: {
                outcome: "applied",
                eventName,
                whatShouldChange: changeRequest.whatShouldChange,
                ...(significant.length > 0 ? { reason } : {}),
              },
            },
          ]
        : [...staff, ...organiserNotice]
    );

    // The toast counts the holders told (PTR-23 AC5). It excludes the Organiser's notice.
    return { changedFields: changes.map(change => change.field), notified: staff.length };
  });
}

/**
 * PTR-52: Lock the waiting change request named by `changeRequestId`. Lock it on an event where
 * the actor is the assigned Coordinator. Take the event lock first, as every event writer does.
 * An apply, a decline, and a cancellation then order against each other. Refuse a missing event,
 * a draft, and another user's event in the same way. Answer 409 for a request outside this event
 * or already processed. A double click or stale page then cannot process it twice.
 */
async function lockWaitingChangeRequest(
  tx: Tx,
  eventId: number,
  changeRequestId: number,
  actor: SessionUser
) {
  const event = (
    await tx.select().from(eventRequests).where(eq(eventRequests.id, eventId)).for("update")
  ).at(0);
  if (!event || event.status === "draft" || event.assignedCoordinatorId !== actor.id) {
    throw new AuthorizationError("Forbidden");
  }
  const changeRequest = (
    await tx
      .select()
      .from(eventChangeRequests)
      .where(
        and(
          eq(eventChangeRequests.id, changeRequestId),
          eq(eventChangeRequests.eventRequestId, event.id)
        )
      )
      .for("update")
  ).at(0);
  if (!changeRequest || changeRequest.outcome !== null) {
    throw new ConflictError(CHANGE_REQUEST_NOT_WAITING_MESSAGE);
  }
  return { event, changeRequest };
}

/**
 * PTR-52 AC2, AC5: The assigned Coordinator declines a waiting change request with a reason.
 * Leave the event unchanged in every status, as with a cancellation request. Keep the outcome
 * and reason on the request record. Tell the Organiser in the same transaction.
 */
export async function handleDeclineEventChangeRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseEventChangeRequestDeclineInput(data);

  return database.transaction(async tx => {
    const { event, changeRequest } = await lockWaitingChangeRequest(
      tx,
      input.id,
      input.changeRequestId,
      actor
    );

    const declined = await tx
      .update(eventChangeRequests)
      .set({
        outcome: "declined",
        declineReason: input.reason,
        processedById: actor.id,
        processedByName: actor.name?.trim() || actor.email,
        processedAt: new Date(),
      })
      .where(and(eq(eventChangeRequests.id, changeRequest.id), isNull(eventChangeRequests.outcome)))
      .returning();
    if (declined.length === 0) throw new ConflictError(CHANGE_REQUEST_NOT_WAITING_MESSAGE);
    await raiseNotifications(tx, [
      {
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "event_change_processed",
        payload: {
          outcome: "declined",
          eventName: event.eventName.trim() || "Untitled request",
          whatShouldChange: changeRequest.whatShouldChange,
          reason: input.reason,
        },
      },
    ]);

    return declined[0];
  });
}

/**
 * PTR-23 AC5: Name the changed significant fields to each arrangement holder. Tell the Venue
 * Staff on each approved booking and each Technical Support member with a reservation. The Venue
 * Staff copy names the booking, never the event (PTR-8). A tentative hold belongs to the
 * Coordinator and names no one. Commit the rows with the update. The worker sends the emails.
 */
async function significantChangeNotices(
  tx: Tx,
  event: { id: number; eventName: string },
  changedFields: SignificantField[],
  actorName: string,
  reason: string
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
        reason,
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
        reason,
      },
    });
  }
  return notices;
}
