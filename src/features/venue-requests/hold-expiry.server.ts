import { and, asc, eq, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, notifications, venueHolds, venues } from "#/db/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { vacateVenue } from "#/features/venue-requests/occupancy.server";
import { keyShareEvents, lockVenue } from "#/features/venue-requests/venue-lock.server";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { venueLocalTimestamp } from "#/features/venues/availability";
import { logger } from "#/lib/logger";

type Database = typeof Db;

const log = logger.getChild("venue-holds");

/**
 * PTR-143: expire the tentative holds whose deadline passed, and warn their Coordinators before it
 * does. The sweep runs in one transaction and takes one venue's advisory lock at a time, in
 * ascending id order, as every occupancy writer does. The lock serializes the sweep with an expiry
 * extension: a hold extended before the sweep reads its row keeps the new expiry.
 *
 * A hold whose warning time passed while its expiry is still ahead gets the warning notice. A hold
 * past its expiry gets the expiry notice only, so a sweep that was down over the warning point
 * sends no stale warning. A hold with no expiry is never due.
 *
 * Exact-once follows the registration sweep: the venue lock orders overlapping runs, and a notice
 * is raised only when no row exists for the hold, the kind and the recipient. One event can hold
 * several venues, so the hold id identifies a notice, not the event. The first read fixes which
 * holds this run may touch; a hold whose event had no due hold at that read waits for the next run.
 *
 * Return the number of holds expired.
 */
export async function sweepVenueHoldExpiries(
  db: Database,
  now: Date = new Date()
): Promise<number> {
  const nowLocal = venueLocalTimestamp(now);

  return db.transaction(async tx => {
    const due = await tx
      .selectDistinct({ venueId: venueHolds.venueId, eventId: venueHolds.eventId })
      .from(venueHolds)
      .where(and(eq(venueHolds.status, "held"), dueExpiry(nowLocal)))
      .orderBy(asc(venueHolds.venueId), asc(venueHolds.eventId));

    // Take the event locks before any venue lock, in ascending order, as every occupancy writer
    // does (ADR-7). The notice insert would otherwise take an event key share through its foreign
    // key while the sweep already holds a venue lock.
    await keyShareEvents(tx, [...new Set(due.map(row => row.eventId))]);

    const dueByVenue = new Map<number, number[]>();
    for (const { venueId, eventId } of due) {
      const eventIds = dueByVenue.get(venueId);
      if (eventIds) eventIds.push(eventId);
      else dueByVenue.set(venueId, [eventId]);
    }

    let expired = 0;
    // Ascending venue order, from the read above.
    for (const [venueId, eventIds] of dueByVenue) {
      // The read that decides each hold's fate happens after this lock, so it sees every
      // committed change to the venue's holds.
      // oxlint-disable-next-line eslint/no-await-in-loop -- one venue lock at a time, in id order
      await lockVenue(tx, venueId);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one venue at a time, under its lock
      expired += await sweepVenueHolds(tx, venueId, eventIds, nowLocal);
    }
    return expired;
  });
}

/** A hold with an expiry that passed, or a recorded warning point that passed. */
function dueExpiry(nowLocal: string) {
  return and(
    isNotNull(venueHolds.expiresAt),
    or(
      lte(venueHolds.expiresAt, nowLocal),
      and(isNotNull(venueHolds.warnAt), lte(venueHolds.warnAt, nowLocal))
    )
  );
}

/**
 * Expire and notify the due holds of one venue. The caller holds the venue lock. Raise the expiry
 * notice only for a row this transaction flipped, and skip a notice that no recipient can read.
 *
 * `eventIds` are the events the sweep key-shared before the venue lock. Read only their holds, so
 * a hold that becomes due after that read waits for the next minute instead of taking an event
 * lock behind the venue lock.
 */
async function sweepVenueHolds(
  tx: VenueTx,
  venueId: number,
  eventIds: number[],
  nowLocal: string
): Promise<number> {
  const holds = await tx
    .select({
      id: venueHolds.id,
      eventId: venueHolds.eventId,
      venueId: venueHolds.venueId,
      venueName: venues.name,
      startsAt: venueHolds.startsAt,
      endsAt: venueHolds.endsAt,
      expiresAt: venueHolds.expiresAt,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
      heldById: venueHolds.heldById,
    })
    .from(venueHolds)
    .innerJoin(venues, eq(venues.id, venueHolds.venueId))
    .innerJoin(eventRequests, eq(eventRequests.id, venueHolds.eventId))
    .where(
      and(
        eq(venueHolds.venueId, venueId),
        inArray(venueHolds.eventId, eventIds),
        eq(venueHolds.status, "held"),
        dueExpiry(nowLocal)
      )
    );

  if (holds.length === 0) return 0;

  const existing = await tx
    .select({
      holdId: sql<string>`${notifications.payload} ->> 'venueHoldId'`,
      kind: notifications.kind,
      recipientId: notifications.recipientId,
    })
    .from(notifications)
    .where(
      and(
        inArray(notifications.eventRequestId, [...new Set(holds.map(hold => hold.eventId))]),
        inArray(notifications.kind, ["venue_hold_expiring", "venue_hold_expired"])
      )
    );
  const notified = new Set(existing.map(row => `${row.holdId}:${row.kind}:${row.recipientId}`));

  const notices: NewNotification[] = [];
  let expired = 0;

  for (const hold of holds) {
    const { expiresAt } = hold;
    if (expiresAt === null) continue;
    const expiredNow = expiresAt <= nowLocal;

    if (expiredNow) {
      // Flip the hold only while it is still `held` and its expiry has passed. An extension that
      // committed first moved the expiry ahead, so the row does not match.
      // oxlint-disable-next-line eslint/no-await-in-loop -- one hold's guarded flip at a time
      const flipped = await tx
        .update(venueHolds)
        .set({ status: "expired" })
        .where(
          and(
            eq(venueHolds.id, hold.id),
            eq(venueHolds.status, "held"),
            lte(venueHolds.expiresAt, nowLocal)
          )
        )
        .returning({ id: venueHolds.id });
      if (!flipped.at(0)) continue;
      // oxlint-disable-next-line eslint/no-await-in-loop -- free the row of the hold just expired
      await vacateVenue(tx, { venueHoldId: hold.id });
      expired += 1;
    }

    // The assigned Coordinator, else the Coordinator who requested the hold (PTR-150 leaves
    // `heldById` on a placed request).
    const recipientId = hold.assignedCoordinatorId ?? hold.heldById;
    const kind = expiredNow ? "venue_hold_expired" : "venue_hold_expiring";
    if (recipientId === null) {
      log.warn("No Coordinator to notify of the hold expiry", { holdId: hold.id, kind });
      continue;
    }
    if (notified.has(`${hold.id}:${kind}:${recipientId}`)) continue;

    const notice = {
      recipientId,
      eventRequestId: hold.eventId,
      payload: {
        venueHoldId: hold.id,
        venueId: hold.venueId,
        venueName: hold.venueName,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        expiresAt,
      },
    };
    notices.push({ ...notice, kind });
  }

  await raiseNotifications(tx, notices);
  return expired;
}
