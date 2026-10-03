import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { equipmentRequests, eventRequests, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { confirmationBlockers, confirmationRefusalMessage } from "#/features/events/confirmation";
import { raiseNotifications } from "#/features/notifications/raise.server";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event_request:coordinate`.
 */

type Database = typeof Db;

/**
 * PTR-24 AC1/AC2/AC4: the assigned Coordinator confirms an event once its arrangements are in
 * place. The event's equipment lines, the event row and its venue requests are locked before the gate
 * reads them, so a booking released or a line changed at the same moment makes this wait and then
 * see the new state, rather than confirming against arrangements that no longer hold. Who and
 * when are recorded on the event in the same statement as the status.
 *
 * The Organiser's notification is raised with the confirmation; the worker delivers the email.
 */
export async function handleConfirmEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  const confirmed = await database.transaction(async tx => {
    // Locks: lines, then event, then venue requests. Line saves (`loadEditableEvent`) take the
    // event before their line, so a save or remove racing this confirmation can deadlock; Postgres
    // aborts the loser with 40P01. No ADR-5 `lockVenue`: this transaction writes no venue row, and
    // a future venue write here must take that lock first.
    const equipmentRows = await tx
      .select()
      .from(equipmentRequests)
      .where(eq(equipmentRequests.eventId, input.id))
      .for("update");
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    // A missing event and someone else's event are refused the same way, so the refusal does not
    // say whether the id exists.
    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Forbidden");
    }

    const venueRows = await tx
      .select({
        status: venueRequests.status,
        venueName: venues.name,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(eq(venueRequests.eventId, request.id))
      .for("update", { of: venueRequests });

    const blockers = confirmationBlockers({
      status: request.status,
      venueRequestStatuses: venueRows.map(row => row.status),
      equipmentLines: equipmentRows,
      equipmentArrangementsCompletedAt: request.equipmentArrangementsCompletedAt,
    });
    if (blockers.length > 0) throw new ConflictError(confirmationRefusalMessage(blockers));

    // The gate guarantees exactly one approved booking; the throw only narrows the type.
    const booking = venueRows.find(row => row.status === "approved");
    if (!booking) {
      throw new Error("Confirmation gate passed without an approved venue booking");
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

    // The confirmation and the Organiser's notification commit together; the worker sends it.
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
