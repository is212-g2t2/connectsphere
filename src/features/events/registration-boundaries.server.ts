import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { db as Db } from "#/db";
import { eventRequests, notifications } from "#/db/schema";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

type Database = typeof Db;

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
  // 7d ceiling: stops historical backfills on deploy from firing.
  const limitDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const limitMinute = toLocalMinuteValue(venueLocalTimestamp(limitDate));
  let raisedCount = 0;

  await db.transaction(async tx => {
    // Serialize overlapping cron runs, else both pass deduplication check and double-insert
    await tx.execute(sql`SELECT pg_advisory_xact_lock(49, 0)`);

    // We need to fetch confirmed events with registrationEnabled = true
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
          isNotNull(eventRequests.registrationOpensAt),
          isNotNull(eventRequests.registrationClosesAt),
          gte(eventRequests.registrationClosesAt, limitMinute)
        )
      );

    const notificationsToRaise: NewNotification[] = [];

    // Amendment gap: once-per-event-kind-recipient means shifted windows don't re-notify
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

    const hasNotif = (
      eventId: number,
      kind: "registration_opened" | "registration_closed",
      recipientId: string
    ) => {
      return existingNotifs.has(`${eventId}:${kind}:${recipientId}`);
    };

    for (const event of events) {
      const opensAt = event.registrationOpensAt;
      const closesAt = event.registrationClosesAt;
      const confirmedAt = event.confirmedAt;
      if (!opensAt || !closesAt || !confirmedAt) continue;

      // Compare at second precision: a 12:00:30 confirmation must not pass a 12:00 close.
      const confirmedLocalInstant = venueLocalTimestamp(confirmedAt).replace(" ", "T");
      const hasOpened = opensAt <= nowMinute && confirmedLocalInstant < closesAt;
      const isClosed = closesAt <= nowMinute && confirmedLocalInstant < closesAt;

      // Boundary notice tracks the registration window only; released approved bookings
      // (venueCapacity null => unavailable) are checked at registration by registrationAvailability.
      if (hasOpened) {
        // Raise registration_opened
        const payload = {
          eventName: event.eventName,
          opensAt,
        };

        if (!hasNotif(event.id, "registration_opened", event.organiserId)) {
          notificationsToRaise.push({
            recipientId: event.organiserId,
            eventRequestId: event.id,
            kind: "registration_opened",
            payload: { ...payload, audience: "organiser" },
          });
        }

        if (
          event.assignedCoordinatorId &&
          event.assignedCoordinatorId !== event.organiserId &&
          !hasNotif(event.id, "registration_opened", event.assignedCoordinatorId)
        ) {
          notificationsToRaise.push({
            recipientId: event.assignedCoordinatorId,
            eventRequestId: event.id,
            kind: "registration_opened",
            payload: { ...payload, audience: "coordinator" },
          });
        }
      }

      if (isClosed) {
        // Raise registration_closed
        const payload = {
          eventName: event.eventName,
          closesAt,
        };

        if (!hasNotif(event.id, "registration_closed", event.organiserId)) {
          notificationsToRaise.push({
            recipientId: event.organiserId,
            eventRequestId: event.id,
            kind: "registration_closed",
            payload: { ...payload, audience: "organiser" },
          });
        }

        if (
          event.assignedCoordinatorId &&
          event.assignedCoordinatorId !== event.organiserId &&
          !hasNotif(event.id, "registration_closed", event.assignedCoordinatorId)
        ) {
          notificationsToRaise.push({
            recipientId: event.assignedCoordinatorId,
            eventRequestId: event.id,
            kind: "registration_closed",
            payload: { ...payload, audience: "coordinator" },
          });
        }
      }
    }

    await raiseNotifications(tx, notificationsToRaise);
    raisedCount += notificationsToRaise.length;
  });

  return raisedCount;
}
