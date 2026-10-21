import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { db as Db } from "#/db";
import { eventRegistrations, eventRequests, notifications } from "#/db/schema";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { stakeholderRecipients } from "#/features/events/register.server";

type Database = typeof Db;

type BoundaryKind = "registration_opened" | "registration_closed";

/**
 * PTR-49: Raise `registration_opened` and `registration_closed` notices for confirmed events with
 * registration windows. Suppress events confirmed after their `closesAt`. No late opened or
 * closed notice fires.
 */
export async function sweepRegistrationWindows(
  db: Database,
  now: Date = new Date()
): Promise<number> {
  const nowMinute = toLocalMinuteValue(venueLocalTimestamp(now));
  // Catch-up ceiling: sweep only windows closing at or after this horizon.
  const limitDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const limitMinute = toLocalMinuteValue(venueLocalTimestamp(limitDate));

  return db.transaction(async tx => {
    // Order overlapping cron runs with an advisory lock. Without it, both runs pass the check
    // and insert twice. `(49, 0)` is this worker's key space. Venue locks use single-int keys.
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

    // Dedupe on event, kind, and recipient. A shifted or reopened window sends no second notice.
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

      // Compare at second precision. A 12:00:30 confirmation must not pass a 12:00 close.
      const confirmedLocalInstant = venueLocalTimestamp(confirmedAt).replace(" ", "T");
      const confirmedBeforeClose = confirmedLocalInstant < closesAt;
      const hasOpened = opensAt <= nowMinute && confirmedBeforeClose;
      const isClosed = closesAt <= nowMinute && confirmedBeforeClose;

      // A closed window clears the waiting list. Waitlisted rows hold no place, and the
      // Attendees cannot claim one after close. The clear below also covers an event that left
      // `confirmed` or turned registration off before its window closed (PTR-163 AC3).

      // Boundary notices track the registration window only. `registrationAvailability` checks
      // released bookings at registration time.
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
    // PTR-163 AC3: clear the waiting list of every event whose window closed, including one that
    // left `confirmed` or turned registration off before its close. Bound the scan as the sweep is.
    await tx
      .update(eventRegistrations)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(eventRegistrations.status, "waitlisted"),
          inArray(
            eventRegistrations.eventId,
            tx
              .select({ id: eventRequests.id })
              .from(eventRequests)
              .where(
                and(
                  gte(eventRequests.registrationClosesAt, limitMinute),
                  lte(eventRequests.registrationClosesAt, nowMinute)
                )
              )
          )
        )
      );
    return notificationsToRaise.length;
  });
}
