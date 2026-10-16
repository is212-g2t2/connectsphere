import { and, asc, eq, isNotNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  eventRegistrations,
  eventRequests,
  venueOccupancy,
  venueRequests,
  venues,
} from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";
import {
  confirmationBlockers,
  confirmationRefusalMessage,
  VENUE_BOOKING_OUTSTANDING_MESSAGE,
} from "#/features/events/confirmation";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { suspendedPieceWhere } from "#/features/venues/blocked-arrangements.server";

/**
 * Keep this module server-only. Its value import of `#/db/schema` builds tables at module scope,
 * so the bundler keeps the full module. `server-fns.ts` loads it dynamically inside `.handler()`.
 * Middleware already verified the session and `event_request:coordinate`.
 */

type Database = typeof Db;

/**
 * PTR-24 AC1/AC2/AC4: The assigned Coordinator confirms an event once its arrangements are in
 * place. Lock the equipment lines, the event row, and the venue requests before the gate reads
 * them. A booking released or a line changed at the same moment then waits and shows its new
 * state. Confirm against the new state, not against arrangements that no longer hold. Record who
 * confirmed and when on the event in the same statement as the status.
 *
 * An unanswered venue request blocks confirmation (PTR-138/PTR-139). An approval in progress
 * holds the event lock, so confirmation waits for it. A later approval reads `confirmed` and
 * refuses.
 *
 * Raise the Organiser's notification with the confirmation. The worker delivers the email.
 */
export async function handleConfirmEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  const confirmed = await database.transaction(async tx => {
    // Take locks in this order: lines, then event, then venue requests. Line saves
    // (`loadEditableEvent`) take the event before their line. A racing save or remove can deadlock.
    // Postgres aborts the loser with 40P01. This transaction writes no venue or occupancy row, so it
    // takes no ADR-7 `lockVenue`. A future venue write here must take that lock first.
    const equipmentRows = await tx
      .select()
      .from(equipmentRequests)
      .where(eq(equipmentRequests.eventId, input.id))
      .for("update");
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    // Refuse a missing event and another user's event in the same way. The refusal then reveals
    // nothing about the id.
    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }

    const venueRows = await tx
      .select({
        id: venueRequests.id,
        status: venueRequests.status,
        venueName: venues.name,
        venueId: venueRequests.venueId,
        suggestedVenueId: venueRequests.suggestedVenueId,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
        createdAt: venueRequests.createdAt,
        updatedAt: venueRequests.updatedAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(eq(venueRequests.eventId, request.id))
      .orderBy(asc(venueRequests.createdAt), asc(venueRequests.id))
      .for("update", { of: venueRequests });

    // PTR-137 AC2: a booking a live block suspends still reads `approved`; the ledger says so.
    // Only the booking's own pieces count: a suspended hold alone does not hold confirmation back.
    const suspended = await tx
      .select({ id: venueOccupancy.id })
      .from(venueOccupancy)
      .where(and(suspendedPieceWhere(request.id), isNotNull(venueOccupancy.venueRequestId)))
      .limit(1);
    const blockers = confirmationBlockers({
      status: request.status,
      venueRequests: venueRows,
      venueBookingSuspended: suspended.length > 0,
      equipmentLines: equipmentRows,
      equipmentArrangementsCompletedAt: request.equipmentArrangementsCompletedAt,
    });
    if (blockers.length > 0) throw new ConflictError(confirmationRefusalMessage(blockers));

    // The gate guarantees at least one approved booking. Rows are ordered by createdAt then id,
    // so find() returns the same earliest-created approved booking as the event page.
    const booking = venueRows.find(row => row.status === "approved");
    if (!booking) {
      // Cannot fire: confirmationBlockers guarantees an approved booking when blockers is empty.
      throw new ConflictError(confirmationRefusalMessage([VENUE_BOOKING_OUTSTANDING_MESSAGE]));
    }

    const [updated] = await tx
      .update(eventRequests)
      .set({
        status: "confirmed",
        confirmedById: actor.id,
        confirmedByName: actor.name,
        confirmedAt: new Date(),
      })
      .where(eq(eventRequests.id, request.id))
      .returning();

    const payload = {
      eventName: updated.eventName.trim() || "Untitled event",
      venueName: booking.venueName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      equipment: equipmentRows.map(line => ({
        id: line.id,
        item: line.item,
        quantity: line.quantity,
        state: arrangementStateLabel(line.arrangementStatus),
      })),
    };
    // PTR-137 AC6: tell each registered Attendee the arrangements now confirmed. Raise one row
    // per attendee in this transaction, as every notification does; the event's place limit
    // bounds the row count. The Attendee copy carries no equipment lines: the Attendee projection
    // never does (PTR-44 AC3), and the worker sends this payload, so strip them here, not only in
    // the template.
    const registered = await tx
      .select({ attendeeId: eventRegistrations.attendeeId })
      .from(eventRegistrations)
      .where(
        and(eq(eventRegistrations.eventId, request.id), eq(eventRegistrations.status, "registered"))
      );
    const attendeeNotices: NewNotification[] = registered.map(({ attendeeId }) => ({
      recipientId: attendeeId,
      eventRequestId: updated.id,
      kind: "event_confirmed",
      payload: { ...payload, equipment: [], audience: "attendee" },
    }));

    // Commit the confirmation and the notifications together. The worker sends the emails.
    await raiseNotifications(tx, [
      {
        recipientId: request.organiserId,
        eventRequestId: updated.id,
        kind: "event_confirmed",
        payload,
      },
      ...attendeeNotices,
    ]);

    return updated;
  });

  return confirmed;
}
