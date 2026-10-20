import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { db as Db } from "#/db";
import {
  equipmentRequests,
  eventRequests,
  safetyReviews,
  user,
  venueOccupancy,
  venueRequests,
  venues,
} from "#/db/schema";
import { listLeadIds } from "#/features/event-requests/leads.server";
import { confirmationBlockers } from "#/features/events/confirmation";
import { revertConfirmedEvents } from "#/features/events/revert.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import { arrangementFingerprint } from "#/features/safety-reviews/fingerprint.server";
import { suspendedPieceWhere } from "#/features/venues/blocked-arrangements.server";
import { venueLocalTimestamp } from "#/features/venues/availability";

type Database = typeof Db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The first approved session starts the event, including a suspended booking. */
export function hasEventStarted(
  bookings: readonly { status: string; startsAt: string }[],
  now: Date
): boolean {
  const first = bookings
    .filter(row => row.status === "approved")
    .map(row => row.startsAt.replace("T", " "))
    .toSorted()
    .at(0);
  return first !== undefined && first <= venueLocalTimestamp(now);
}

/** Process one event per transaction. Never lock a venue or an arrangement row. */
export async function sweepSafetyReviews(database: Database, now?: Date) {
  const candidates = await database
    .select({ id: eventRequests.id })
    .from(eventRequests)
    .where(inArray(eventRequests.status, ["approved", "planning", "confirmed"]))
    .orderBy(asc(eventRequests.id));
  const result = {
    reviewsCreated: 0,
    reviewsUpdated: 0,
    eventsReverted: 0,
    notificationsRaised: 0,
  };
  // Each commit releases the event lock before the next candidate.
  for (const candidate of candidates) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const change = await database.transaction(async tx => {
      // A separate key space from the registration sweep (49, 0).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(148, 0)`);
      return sweepEvent(tx, candidate.id, now);
    });
    result.reviewsCreated += change.reviewsCreated;
    result.reviewsUpdated += change.reviewsUpdated;
    result.eventsReverted += change.eventsReverted;
    result.notificationsRaised += change.notificationsRaised;
  }
  return result;
}

async function sweepEvent(tx: Transaction, eventId: number, now: Date | undefined) {
  const result = {
    reviewsCreated: 0,
    reviewsUpdated: 0,
    eventsReverted: 0,
    notificationsRaised: 0,
  };
  const event = (
    await tx.select().from(eventRequests).where(eq(eventRequests.id, eventId)).for("update")
  ).at(0);
  if (!event || !["approved", "planning", "confirmed"].includes(event.status)) return result;
  // Read the clock after the row lock: a lock wait can cross the event's start time.
  const clock = now ?? new Date();
  const venueRows = await tx
    .select({
      id: venueRequests.id,
      status: venueRequests.status,
      venueName: venues.name,
      venueId: venueRequests.venueId,
      suggestedVenueId: venueRequests.suggestedVenueId,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      replacesRequestId: venueRequests.replacesRequestId,
      dismissedAt: venueRequests.dismissedAt,
      createdAt: venueRequests.createdAt,
      updatedAt: venueRequests.updatedAt,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(eq(venueRequests.eventId, eventId));
  if (hasEventStarted(venueRows, clock)) return result;
  const review = (
    await tx
      .select()
      .from(safetyReviews)
      .where(eq(safetyReviews.eventRequestId, eventId))
      .orderBy(desc(safetyReviews.createdAt), desc(safetyReviews.id))
      .limit(1)
  ).at(0);
  const fingerprint = await arrangementFingerprint(tx, eventId);
  if (fingerprint === null) return result;
  const current = review?.fingerprint === fingerprint;

  if (event.status === "confirmed") {
    // Preserve events confirmed before safety reviews were available.
    if (!review || (current && review.state === "approved")) return result;
    const reverted = await revertConfirmedEvents(tx, [eventId]);
    if (reverted.size === 0) return result;
    result.eventsReverted = reverted.size;
    const recipients =
      event.assignedCoordinatorId === null ? await listLeadIds(tx) : [event.assignedCoordinatorId];
    await raiseNotifications(
      tx,
      recipients.map(recipientId => ({
        recipientId,
        eventRequestId: eventId,
        kind: "event_safety_reconfirmation_required" as const,
        payload: { eventName: event.eventName.trim() || "Untitled event" },
      }))
    );
    result.notificationsRaised += recipients.length;
  }
  // A current decision of any kind requires an arrangement change before another review.
  if (review && current) return result;
  const [equipment, suspended] = await Promise.all([
    tx.select().from(equipmentRequests).where(eq(equipmentRequests.eventId, eventId)),
    tx
      .select({ id: venueOccupancy.id })
      .from(venueOccupancy)
      .where(and(suspendedPieceWhere(eventId), isNotNull(venueOccupancy.venueRequestId)))
      .limit(1),
  ]);
  if (
    confirmationBlockers({
      status: "planning",
      venueRequests: venueRows,
      venueBookingSuspended: suspended.length > 0,
      equipmentLines: equipment,
      equipmentArrangementsCompletedAt: event.equipmentArrangementsCompletedAt,
    }).length > 0
  )
    return result;
  if (review?.state === "pending") {
    await tx
      .update(safetyReviews)
      .set({ fingerprint, refreshedAt: clock })
      .where(eq(safetyReviews.id, review.id));
    result.reviewsUpdated = 1;
    return result;
  }
  await tx.insert(safetyReviews).values({ eventRequestId: eventId, fingerprint });
  const officers = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, "safety_officer"))
    // Hold the referenced accounts while the notices are inserted, as `listLeadIds` does.
    .for("share");
  await raiseNotifications(
    tx,
    officers.map(officer => ({
      recipientId: officer.id,
      eventRequestId: eventId,
      kind: "safety_review_requested" as const,
      payload: { eventName: event.eventName.trim() || "Untitled event" },
    }))
  );
  result.reviewsCreated = 1;
  result.notificationsRaised += officers.length;
  return result;
}
