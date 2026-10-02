import { and, eq, inArray } from "drizzle-orm";
import { createElement } from "react";

import type { db as Db } from "#/db";
import { equipmentRequests, eventRequests, user, venueRequests, venues } from "#/db/schema";
import { env } from "#/env";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { EventConfirmedEmail } from "#/features/emails/components/event-confirmed-email";
import { formatDate, formatTime } from "#/features/emails/format";
import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";
import {
  CONFIRMABLE_STATUSES,
  confirmationBlockers,
  confirmationRefusalMessage,
  VENUE_BOOKING_OUTSTANDING_MESSAGE,
} from "#/features/events/confirmation";
import { logger } from "#/lib/logger";
import { sendEmail } from "#/lib/mailer.server";

const log = logger.getChild("events");

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event_request:coordinate`.
 */

type Database = typeof Db;

/**
 * PTR-24 AC1/AC2/AC4: the assigned Coordinator confirms an event once its arrangements are in
 * place. The event row, its venue requests and its equipment lines are locked before the gate
 * reads them, so a booking released or a line changed at the same moment makes this wait and then
 * see the new state, rather than confirming against arrangements that no longer hold. Who and
 * when are recorded on the event in the same statement as the status.
 *
 * The Organiser is emailed after the commit. A failed send must not undo a confirmation that is
 * already recorded, matching every other notification here.
 */
export async function handleConfirmEvent(data: unknown, actor: SessionUser, database: Database) {
  const input = parseEventRequestId(data);

  const confirmed = await database.transaction(async tx => {
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
    const equipmentRows = await tx
      .select()
      .from(equipmentRequests)
      .where(eq(equipmentRequests.eventId, request.id))
      .for("update");

    const blockers = confirmationBlockers({
      status: request.status,
      venueRequestStatuses: venueRows.map(row => row.status),
      equipmentLines: equipmentRows,
      equipmentArrangementsCompletedAt: request.equipmentArrangementsCompletedAt,
    });
    if (blockers.length > 0) throw new ConflictError(confirmationRefusalMessage(blockers));

    const organiser = (
      await tx.select({ email: user.email }).from(user).where(eq(user.id, request.organiserId))
    ).at(0);

    // The gate guarantees an approved booking; finding it also narrows the type.
    const booking = venueRows.find(row => row.status === "approved");
    if (!booking) {
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
      .where(
        and(
          eq(eventRequests.id, request.id),
          inArray(eventRequests.status, [...CONFIRMABLE_STATUSES])
        )
      )
      .returning();

    return {
      recorded: updated,
      organiserEmail: organiser?.email ?? null,
      venueName: booking.venueName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      equipment: equipmentRows.map(line => ({
        item: line.item,
        quantity: line.quantity,
        state: arrangementStateLabel(line.arrangementStatus),
      })),
    };
  });

  const eventName = confirmed.recorded.eventName.trim() || "Untitled event";
  if (confirmed.organiserEmail === null) {
    log.warn("No Organiser email to notify of event confirmation", {
      eventId: confirmed.recorded.id,
    });
  } else {
    try {
      await sendEmail(
        confirmed.organiserEmail,
        `Event confirmed: ${eventName}`,
        createElement(EventConfirmedEmail, {
          eventName,
          venueName: confirmed.venueName,
          date: formatDate(confirmed.startsAt),
          startTime: formatTime(confirmed.startsAt),
          endTime: formatTime(confirmed.endsAt),
          equipment: confirmed.equipment,
          eventUrl: `${env.BETTER_AUTH_URL}/event-requests/${confirmed.recorded.id}`,
        })
      );
    } catch (error) {
      // The confirmation is already committed; a failed notification must not lose it.
      log.warn("Event confirmation email failed", {
        eventId: confirmed.recorded.id,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  return confirmed.recorded;
}
