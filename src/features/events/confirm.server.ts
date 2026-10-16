import { asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { equipmentRequests, eventRequests, venueRequests, venues } from "#/db/schema";
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

    const blockers = confirmationBlockers({
      status: request.status,
      venueRequests: venueRows,
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

    // Commit the confirmation and the Organiser's notification together. The worker sends the email.
    await raiseNotifications(tx, [
      {
        recipientId: request.organiserId,
        eventRequestId: updated.id,
        kind: "event_confirmed",
        payload: {
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
        },
      },
    ]);

    return updated;
  });

  return confirmed;
}
