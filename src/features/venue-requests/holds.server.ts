import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueHolds, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { loadAssignedEvent } from "#/features/events/records.server";
import {
  rethrowDuplicate,
  sendVenueRequestNotification,
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
 * PTR-109: tentative venue holds at the handler boundary.
 *
 * AC1: Coordinator places a tentative hold naming venue and period -> recorded against event as "held".
 * AC2: Overlapping hold attempts refused (ConflictError 409) naming venue and period. The
 * locked pre-check produces the named refusal; the exclusion-constraint backstop maps to the
 * generic overlap sentence.
 * AC4: Hold refused when approved booking exists (ConflictError 409) naming venue and period.
 * AC7: Stores acting user ID (heldById) and timestamp.
 */
export async function handleCreateVenueHold(data: unknown, actor: SessionUser, database: Database) {
  const input = parseVenueHoldInput(data);

  return database.transaction(async tx => {
    const event = await loadAssignedEvent(tx, input.eventId, actor.id, ["submitted"]);
    if (!event) throw new AuthorizationError("Forbidden");

    const venueRows = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1);
    const venue = venueRows.at(0);
    if (!venue) throw new NotFoundError("Not Found");

    // Serialise per venue before checking conflicts
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
  // The advisory lock must come first: a plain read of the venue, then the lock, then the row
  // lock. Taking the row lock before the advisory lock (as this used to) lets a convert and an
  // approval for the same venue grab them in opposite orders and deadlock (40P01).
  const lockedVenueId = await lockVenueForHold(tx, id);

  // Re-read under the venue lock, locking only the hold row: `of: venueHolds` leaves the joined
  // event_requests row unlocked, so a concurrent event writer cannot deadlock against us.
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
  // An orphaned hold (both actor columns null) has no owner left to release it, so anyone who can
  // reach the hold may. Conversion still runs the assignee+submitted gate below, so an orphan is
  // releasable but not convertible by a stranger.
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
 * PTR-109 AC5: releasing a tentative hold.
 * Frees the period for other events and marks status as "released".
 * Refuses non-creator (403), non-existent ID (404), already released (409).
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
 * PTR-109 AC5: converting a tentative hold to a pending venue request.
 * Releases the hold, creates a pending venue request with matching period/venue/event,
 * and notifies Venue Staff via email.
 */
export async function handleConvertVenueHold(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseVenueHoldId(data);

  const result = await database.transaction(async tx => {
    const { hold, released: releasedHold } = await releaseActiveHold(
      tx,
      id,
      actor.id,
      "This hold has already been released or converted."
    );

    // Conversion creates a pending request, so it applies the same gate as raising one: the event
    // must still be `submitted` and assigned to the caller. `loadAssignedEvent` re-checks that in
    // this transaction, but a handover landing between the calendar read and here still shows a
    // stale Convert; the gate refuses it and the release rolls back with the hold left `held`.
    // Throwing rolls the release back, so the hold stays `held` rather than leaking a freed slot
    // for a request that was never made.
    const assignedEvent = await loadAssignedEvent(tx, hold.eventId, actor.id, ["submitted"]);
    if (!assignedEvent) throw new AuthorizationError("Forbidden");

    // Read before the insert like `handleCreateVenueHold` does; the FK guarantees the row exists.
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
      .select({ email: user.email })
      .from(user)
      .where(eq(user.role, "venue_staff"));

    return {
      hold: releasedHold,
      request: createdRequest,
      venue,
      event,
      recipientEmails: staffRecipients.map(r => r.email),
    };
  });

  if (result.recipientEmails.length === 0) {
    log.warn("No Venue Staff to notify of the venue request", { requestId: result.request.id });
  } else {
    await sendVenueRequestNotification(
      {
        venueName: result.venue.name,
        startsAt: result.request.startsAt,
        endsAt: result.request.endsAt,
        expectedAttendance: result.event?.expectedAttendance ?? null,
        layout: result.event?.roomLayoutPreference ?? "",
        accessibilityRequirements: result.event?.accessibilityRequirements ?? "",
        requiredFacilities: result.event?.venueRequirements ?? "",
      },
      result.recipientEmails
    );
  }

  return {
    hold: result.hold,
    request: result.request,
  };
}
