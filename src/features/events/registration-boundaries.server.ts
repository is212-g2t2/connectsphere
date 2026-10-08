import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { db as Db } from "#/db";
import { eventRequests, notifications } from "#/db/schema";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { stakeholderRecipients } from "#/features/events/register.server";

type Database = typeof Db;

type BoundaryKind = "registration_opened" | "registration_closed";

/**
 * PTR-49: raises registration_opened and registration_closed notifications for
 * confirmed events with registration windows. Events confirmed after their
 * closesAt are suppressed entirely, so no late opened or closed notice fires.
 */
export async function sweepRegistrationWindows(
  db: Database,
  now: Date = new Date()
): Promise<number> {
  const nowMinute = toLocalMinuteValue(venueLocalTimestamp(now));
  // Catch-up ceiling: only windows whose close is at/after this horizon are swept.
  const limitDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const limitMinute = toLocalMinuteValue(venueLocalTimestamp(limitDate));

  return db.transaction(async tx => {
    // Serialize overlapping cron runs, else both pass the check and double-insert.
    // (49, 0) is this worker's space, distinct from the venue locks' single-int keys.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(49, 0)`);

    const events = await tx
      .select({
        id: eventRequests.id,
        eventName: eventRequests.eventName,
        organiserId: eventRequests.organiserId,
        assignedCoordinatorId: eventRequests.assignedCoordinatorId,
        registrationOpensAt: eventRequests.registrationOpensAt,
        registrationClosesAt: eventRequests.registrationClosesAt,
        confirmedAt: eventRequests.confirmedAt,
      })
      .from(eventRequests)
      .where(
        and(
          eq(eventRequests.status, "confirmed"),
          eq(eventRequests.registrationEnabled, true),
          lte(eventRequests.registrationOpensAt, nowMinute),
          gte(eventRequests.registrationClosesAt, limitMinute)
        )
      );

    const notificationsToRaise: NewNotification[] = [];

    // Dedupe keyed event:kind:recipient: a shifted or re-opened window does not re-notify.
    const existingNotifs = new Set<string>();
    if (events.length > 0) {
      const rows = await tx
        .select({
          eventRequestId: notifications.eventRequestId,
          kind: notifications.kind,
          recipientId: notifications.recipientId,
        })
        .from(notifications)
        .where(
          and(
            inArray(
              notifications.eventRequestId,
              events.map(e => e.id)
            ),
            inArray(notifications.kind, ["registration_opened", "registration_closed"])
          )
        );
      for (const row of rows) {
        existingNotifs.add(`${row.eventRequestId}:${row.kind}:${row.recipientId}`);
      }
    }

    const hasNotif = (eventId: number, kind: BoundaryKind, recipientId: string) => {
      return existingNotifs.has(`${eventId}:${kind}:${recipientId}`);
    };

    const raiseBoundary = (
      event: (typeof events)[number],
      kind: BoundaryKind,
      build: (recipientId: string, audience: "organiser" | "coordinator") => NewNotification,
      active: boolean
    ) => {
      if (!active) return;
      const handled = new Set<string>();
      for (const { recipientId, audience } of stakeholderRecipients(event)) {
        if (handled.has(recipientId)) continue;
        handled.add(recipientId);
        if (hasNotif(event.id, kind, recipientId)) continue;
        notificationsToRaise.push(build(recipientId, audience));
      }
    };

    for (const event of events) {
      const opensAt = event.registrationOpensAt;
      const closesAt = event.registrationClosesAt;
      const confirmedAt = event.confirmedAt;
      if (!opensAt || !closesAt || !confirmedAt) continue;

      // Compare at second precision: a 12:00:30 confirmation must not pass a 12:00 close.
      const confirmedLocalInstant = venueLocalTimestamp(confirmedAt).replace(" ", "T");
      const confirmedBeforeClose = confirmedLocalInstant < closesAt;
      const hasOpened = opensAt <= nowMinute && confirmedBeforeClose;
      const isClosed = closesAt <= nowMinute && confirmedBeforeClose;

      // Boundary notice tracks the registration window only; released approved bookings
      // (venueCapacity null => unavailable) are checked at registration by registrationAvailability.
      raiseBoundary(
        event,
        "registration_opened",
        (recipientId, audience) => ({
          recipientId,
          eventRequestId: event.id,
          kind: "registration_opened",
          payload: { eventName: event.eventName, opensAt, audience },
        }),
        hasOpened
      );
      raiseBoundary(
        event,
        "registration_closed",
        (recipientId, audience) => ({
          recipientId,
          eventRequestId: event.id,
          kind: "registration_closed",
          payload: { eventName: event.eventName, closesAt, audience },
        }),
        isClosed
      );
    }

    await raiseNotifications(tx, notificationsToRaise);
    return notificationsToRaise.length;
  });
}
