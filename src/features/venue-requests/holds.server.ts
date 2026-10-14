import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueHolds, venueRequests } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { loadAssignedEvent } from "#/features/events/records.server";
import {
  assertNoEventOverlap,
  loadLockedVenue,
  raiseVenueRequestNotifications,
  rethrowDuplicate,
} from "#/features/venue-requests/requests.server";
import { parseVenueHoldId, parseVenueHoldInput } from "#/features/venue-requests/schema";
import { canReleaseHold } from "#/features/venue-requests/holds";
import {
  checkVenueFree,
  occupyVenue,
  vacateVenue,
} from "#/features/venue-requests/occupancy.server";
import {
  assertSameVenue,
  keyShareEvent,
  keyShareEventForHold,
  lockVenue,
  lockVenueForHold,
} from "#/features/venue-requests/venue-lock.server";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";
import { logger } from "#/lib/logger";

type Database = typeof Db;

const log = logger.getChild("venue-holds");

/**
 * PTR-109: Handle tentative venue holds.
 * AC1: Record the venue and period as held on the event.
 * AC2: Return 409 for overlapping holds and name the venue and period. The locked pre-check gives
 * this refusal. The exclusion-constraint fallback uses the generic overlap message.
 * AC4: Return 409 and name the venue and period when an approved booking overlaps.
 * AC7: Store the acting user's id (`heldById`) and timestamp.
 * PTR-54 AC9: Refuse a new hold for a cancelled event.
 * PTR-138: Accept the event statuses that a venue request accepts (`SEARCHABLE_EVENT_STATUSES`).
 * PTR-134 AC2: Write the hold's ledger row, with the hold's buffers, in the same transaction.
 */
export async function handleCreateVenueHold(data: unknown, actor: SessionUser, database: Database) {
  const input = parseVenueHoldInput(data);

  return database.transaction(async tx => {
    // Lock the event before the venue. This waits for a cancellation in progress. A later
    // cancellation waits for this transaction to commit.
    const locked = await keyShareEvent(tx, input.eventId);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const event = await loadAssignedEvent(tx, input.eventId, actor.id, SEARCHABLE_EVENT_STATUSES);
    if (!event) throw new AuthorizationError("Forbidden");

    // Serialize before reading buffers. A simultaneous venue edit uses the same lock.
    await lockVenue(tx, input.venueId);
    const startsAt = `${input.date} ${input.startTime}:00`;
    const endsAt = `${input.date} ${input.endTime}:00`;
    const occupancy = await checkVenueFree(tx, {
      venueId: input.venueId,
      eventId: event.id,
      startsAt,
      endsAt,
    });

    const [created] = await tx
      .insert(venueHolds)
      .values({ ...occupancy, id: crypto.randomUUID(), heldById: actor.id })
      .returning();
    await occupyVenue(tx, { ...occupancy, venueHoldId: created.id });

    return created;
  });
}

async function releaseActiveHold(
  tx: VenueTx,
  id: string,
  actorId: string,
  conflictMessage = "This hold has already been released."
) {
  // Read the venue, take the advisory lock, then lock the row. Locking the row first lets a
  // conversion and approval take locks in opposite orders and deadlock (40P01).
  const lockedVenueId = await lockVenueForHold(tx, id);

  // Re-read under the venue lock. Lock only the hold row with `of: venueHolds`; do not lock the
  // joined `event_requests` row, or a concurrent event writer could deadlock.
  const rows = await tx
    .select({
      id: venueHolds.id,
      eventId: venueHolds.eventId,
      venueId: venueHolds.venueId,
      startsAt: venueHolds.startsAt,
      endsAt: venueHolds.endsAt,
      heldById: venueHolds.heldById,
      status: venueHolds.status,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
    })
    .from(venueHolds)
    .innerJoin(eventRequests, eq(eventRequests.id, venueHolds.eventId))
    .where(eq(venueHolds.id, id))
    .for("update", { of: venueHolds });
  const hold = rows.at(0);
  if (!hold) throw new NotFoundError("Not Found");
  assertSameVenue(lockedVenueId, hold.venueId);
  // An orphaned hold has no owner because both actor columns are null. Let any user who can reach
  // it release the hold. The assignee and event-status checks still prevent conversion.
  if (!canReleaseHold(hold, actorId)) {
    throw new AuthorizationError("Forbidden");
  }
  if (hold.status !== "held") {
    throw new ConflictError(conflictMessage);
  }

  const [released] = await tx
    .update(venueHolds)
    .set({
      status: "released",
      releasedById: actorId,
    })
    .where(eq(venueHolds.id, id))
    .returning({
      id: venueHolds.id,
      status: venueHolds.status,
    });
  await vacateVenue(tx, { venueHoldId: id });

  return { hold, released };
}

/**
 * PTR-109 AC5: Release a tentative hold and mark it `released`.
 * This frees the period for other events: the hold's ledger row goes in the same transaction.
 * Return 403 for a non-creator, 404 for a missing id, and 409 for a hold that is already released.
 */
export async function handleReleaseVenueHold(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseVenueHoldId(data);

  return database.transaction(async tx => {
    const { released } = await releaseActiveHold(tx, id, actor.id);
    return released;
  });
}

/**
 * PTR-109 AC5: Convert a tentative hold to a pending venue request.
 * Release the hold, create a request for the same venue, period, and event, and notify Venue Staff.
 * The release removes the hold's ledger row. A pending request holds no venue time, so it gets none.
 * The new request follows the creation rules: the overlap check (PTR-138 AC4) and the duplicate
 * index refuse it, and the refusal rolls back the release.
 * PTR-54 AC9: A cancelled event cannot get a new request, so its hold can only be released.
 */
export async function handleConvertVenueHold(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseVenueHoldId(data);

  const result = await database.transaction(async tx => {
    // Lock the event before the venue. This waits for a cancellation in progress. A later
    // cancellation waits for this transaction to commit.
    const locked = await keyShareEventForHold(tx, id);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const { hold, released: releasedHold } = await releaseActiveHold(
      tx,
      id,
      actor.id,
      "This hold has already been released or converted."
    );

    // Conversion creates a pending request, so apply the request gate: an assigned event in
    // `SEARCHABLE_EVENT_STATUSES`. `loadAssignedEvent` re-checks this in the transaction. If a
    // handover or a status change makes the calendar's Convert action stale, refuse it and roll
    // back the release. The hold then stays `held`.
    const assignedEvent = await loadAssignedEvent(
      tx,
      hold.eventId,
      actor.id,
      SEARCHABLE_EVENT_STATUSES
    );
    if (!assignedEvent) throw new AuthorizationError("Forbidden");

    // The release took the venue lock, so the buffers and the event's requests stay current.
    // PTR-138 AC4: refuse a hold window that overlaps the event's own request at this venue.
    const venue = await loadLockedVenue(tx, hold.venueId);
    await assertNoEventOverlap(tx, venue, {
      eventId: hold.eventId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
    });

    const [createdRequest] = await tx
      .insert(venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: hold.eventId,
        venueId: hold.venueId,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        requestedById: actor.id,
        status: "pending",
      })
      .returning()
      .catch(rethrowDuplicate);

    const eventRows = await tx
      .select({
        expectedAttendance: eventRequests.expectedAttendance,
        roomLayoutPreference: eventRequests.roomLayoutPreference,
        accessibilityRequirements: eventRequests.accessibilityRequirements,
        venueRequirements: eventRequests.venueRequirements,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, hold.eventId))
      .limit(1);
    const event = eventRows.at(0);

    const staffRecipients = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "venue_staff"));

    // The request and its notifications commit together; the worker sends the emails.
    await raiseVenueRequestNotifications(
      tx,
      {
        venueRequestId: createdRequest.id,
        eventId: hold.eventId,
        venueName: venue.name,
        startsAt: createdRequest.startsAt,
        endsAt: createdRequest.endsAt,
        expectedAttendance: event?.expectedAttendance ?? null,
        layout: event?.roomLayoutPreference ?? "",
        accessibilityRequirements: event?.accessibilityRequirements ?? "",
        requiredFacilities: event?.venueRequirements ?? "",
      },
      staffRecipients.map(recipient => recipient.id)
    );

    return {
      hold: releasedHold,
      request: createdRequest,
      recipientCount: staffRecipients.length,
    };
  });

  if (result.recipientCount === 0) {
    log.warn("No Venue Staff to notify of the venue request", { requestId: result.request.id });
  }

  return {
    hold: result.hold,
    request: result.request,
  };
}
