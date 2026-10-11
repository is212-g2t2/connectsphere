import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueHolds, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { loadAssignedEvent } from "#/features/events/records.server";
import {
  raiseVenueRequestNotifications,
  rethrowDuplicate,
} from "#/features/venue-requests/requests.server";
import {
  parseVenueHoldId,
  parseVenueHoldInput,
  VENUE_HOLD_OVERLAP_MESSAGE,
  venueHoldConflictMessage,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";
import { canReleaseHold } from "#/features/venue-requests/holds";
import {
  assertSameVenue,
  keyShareEvent,
  keyShareEventForHold,
  lockVenue,
  lockVenueForHold,
} from "#/features/venue-requests/venue-lock.server";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { loadVenueBookings, loadVenueHolds } from "#/features/venues/records.server";
import { isConstraintViolation } from "#/lib/db-errors";
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
 */
export async function handleCreateVenueHold(data: unknown, actor: SessionUser, database: Database) {
  const input = parseVenueHoldInput(data);

  return database.transaction(async tx => {
    // Lock the event before the venue. This waits for a cancellation in progress. A later
    // cancellation waits for this transaction to commit.
    const locked = await keyShareEvent(tx, input.eventId);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const event = await loadAssignedEvent(tx, input.eventId, actor.id, ["submitted"]);
    if (!event) throw new AuthorizationError("Forbidden");

    const venueRows = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1);
    const venue = venueRows.at(0);
    if (!venue) throw new NotFoundError("Not Found");

    // Serialize by venue before checking conflicts.
    await lockVenue(tx, venue.id);

    const startsAt = `${input.date} ${input.startTime}:00`;
    const endsAt = `${input.date} ${input.endTime}:00`;

    const bookings = await loadVenueBookings(tx, [venue.id], startsAt, endsAt);
    const bookingConflict = bookings.at(0);
    if (bookingConflict) {
      throw new ConflictError(
        venueRequestConflictMessage({
          venueName: venue.name,
          startsAt: bookingConflict.startsAt,
          endsAt: bookingConflict.endsAt,
        })
      );
    }

    const holds = await loadVenueHolds(tx, [venue.id], startsAt, endsAt);
    const holdConflict = holds.at(0);
    if (holdConflict) {
      throw new ConflictError(
        venueHoldConflictMessage({
          venueName: venue.name,
          startsAt: holdConflict.startsAt,
          endsAt: holdConflict.endsAt,
        })
      );
    }

    const [created] = await tx
      .insert(venueHolds)
      .values({
        id: crypto.randomUUID(),
        eventId: event.id,
        venueId: venue.id,
        startsAt,
        endsAt,
        heldById: actor.id,
      })
      .returning()
      .catch(error => {
        if (isConstraintViolation(error, "venue_holds_no_overlap")) {
          throw new ConflictError(VENUE_HOLD_OVERLAP_MESSAGE);
        }
        throw error;
      });

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
  // it release the hold. The assignee and submitted-status checks still prevent conversion.
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

  return { hold, released };
}

/**
 * PTR-109 AC5: Release a tentative hold and mark it `released`.
 * This frees the period for other events. Return 403 for a non-creator, 404 for a missing id, and
 * 409 for a hold that is already released.
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

    // Conversion creates a pending request, so require an assigned event in `submitted` status.
    // `loadAssignedEvent` re-checks this in the transaction. If a handover makes the calendar's
    // Convert action stale, refuse it and roll back the release. The hold then stays `held`.
    const assignedEvent = await loadAssignedEvent(tx, hold.eventId, actor.id, ["submitted"]);
    if (!assignedEvent) throw new AuthorizationError("Forbidden");

    // Read before insert, as `handleCreateVenueHold` does. The foreign key guarantees the row exists.
    const venueRows = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.id, hold.venueId))
      .limit(1);
    const venue = venueRows.at(0);
    if (!venue) throw new NotFoundError("Not Found");

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
