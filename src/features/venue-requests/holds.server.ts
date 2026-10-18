import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueHolds, venueRequests } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import {
  assertNoEventOverlap,
  checkSessionRequirements,
  loadLockedVenue,
  raiseVenueRequestNotifications,
  rethrowDuplicate,
} from "#/features/venue-requests/requests.server";
import { venueLocalTimestamp } from "#/features/venues/availability";
import { raiseNotifications } from "#/features/notifications/raise.server";
import {
  VENUE_HOLD_EXPIRY_BEFORE_WARNING_MESSAGE,
  VENUE_HOLD_EXPIRY_PAST_MESSAGE,
  VENUE_HOLD_WARNING_NEEDS_EXPIRY_MESSAGE,
  VENUE_HOLD_WARNING_ORDER_MESSAGE,
  VENUE_HOLD_WARNING_PAST_MESSAGE,
  parseVenueHoldConversion,
  parseVenueHoldExpiry,
  parseVenueHoldId,
  parseVenueHoldInput,
  parseVenueHoldWarning,
} from "#/features/venue-requests/schema";
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
import { loadAssignedEvent } from "#/features/venues/records.server";
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
 * PTR-138 AC4: Refuse a hold that overlaps a pending request of the same event at the venue
 * (`assertNoEventOverlap`). Otherwise approval of the request and conversion of the hold both fail.
 * PTR-134 AC2: Write the hold's ledger row, with the hold's buffers, in the same transaction.
 */
export async function handleCreateVenueHold(data: unknown, actor: SessionUser, database: Database) {
  const input = parseVenueHoldInput(data);

  return database.transaction(async tx => {
    // Lock the event before the venue. This waits for a cancellation in progress. A later
    // cancellation waits for this transaction to commit.
    const locked = await keyShareEvent(tx, input.eventId);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const event = await loadAssignedEvent(tx, input.eventId, actor.id);
    if (!event) throw new AuthorizationError("Forbidden");

    // Serialize before reading buffers. A simultaneous venue edit uses the same lock.
    await lockVenue(tx, input.venueId);
    const venue = await loadLockedVenue(tx, input.venueId);
    const requested = {
      eventId: event.id,
      startsAt: `${input.date} ${input.startTime}:00`,
      endsAt: `${input.date} ${input.endTime}:00`,
    };
    const occupancy = await checkVenueFree(tx, venue, requested);
    // `checkVenueFree` refuses every block, booking and hold. Only a pending request can refuse here.
    await assertNoEventOverlap(tx, venue, requested);

    const [created] = await tx
      .insert(venueHolds)
      .values({ ...occupancy, id: crypto.randomUUID(), heldById: actor.id })
      .returning();
    await occupyVenue(tx, { ...occupancy, venueHoldId: created.id });

    return created;
  });
}

/**
 * Take the venue lock and then the hold row lock, and return the hold with its event's assignee.
 * Refuse a missing hold. The caller checks status and ownership.
 */
async function lockHold(tx: VenueTx, id: string) {
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
      expiresAt: venueHolds.expiresAt,
      warnAt: venueHolds.warnAt,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
    })
    .from(venueHolds)
    .innerJoin(eventRequests, eq(eventRequests.id, venueHolds.eventId))
    .where(eq(venueHolds.id, id))
    .for("update", { of: venueHolds });
  const hold = rows.at(0);
  if (!hold) throw new NotFoundError("Not Found");
  assertSameVenue(lockedVenueId, hold.venueId);
  return hold;
}

/**
 * Lock an active hold that the actor can release, and return it. Refuse a missing hold, another
 * user's hold, and a hold that is no longer held. The caller releases it with `releaseHold`.
 */
async function lockActiveHold(
  tx: VenueTx,
  id: string,
  actorId: string,
  conflictMessage = "This hold is no longer active."
) {
  const hold = await lockHold(tx, id);
  // An orphaned hold has no owner because both actor columns are null. Let any user who can reach
  // it release the hold. The assignee and event-status checks still prevent conversion.
  if (!canReleaseHold(hold, actorId)) {
    throw new AuthorizationError("Forbidden");
  }
  if (hold.status !== "held") {
    throw new ConflictError(conflictMessage);
  }
  return hold;
}

/** Mark a hold that `lockActiveHold` locked as released, and free its ledger row. */
async function releaseHold(tx: VenueTx, id: string, actorId: string) {
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
  return released;
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
    await lockActiveHold(tx, id, actor.id);
    return releaseHold(tx, id, actor.id);
  });
}

/**
 * PTR-109 AC5: Convert a tentative hold to a pending venue request. Release the hold, create a
 * request for the same venue, period, and event, and notify Venue Staff. The release removes the
 * hold's ledger row. A pending request holds no venue time, so it gets none.
 *
 * The new request follows the creation rules: the venue must meet the session requirements, which
 * default to the event's (PTR-138 AC1), and the overlap check and duplicate index apply (AC4).
 * Every check runs in the release's transaction, so a refusal rolls the release back and leaves
 * the hold held.
 *
 * PTR-54 AC9: A cancelled event cannot get a new request, so its hold can only be released.
 */
export async function handleConvertVenueHold(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id, ...session } = parseVenueHoldConversion(data);

  const result = await database.transaction(async tx => {
    // Lock the event before the venue. This waits for a cancellation in progress. A later
    // cancellation waits for this transaction to commit.
    const locked = await keyShareEventForHold(tx, id);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const hold = await lockActiveHold(
      tx,
      id,
      actor.id,
      "This hold is no longer active or has been converted."
    );

    // Conversion creates a pending request, so apply the request gate: an assigned event in
    // `SEARCHABLE_EVENT_STATUSES`. `loadAssignedEvent` re-checks this in the transaction. If a
    // handover or a status change makes the calendar's Convert action stale, refuse it. The hold
    // then stays `held`.
    const assignedEvent = await loadAssignedEvent(tx, hold.eventId, actor.id);
    if (!assignedEvent) throw new AuthorizationError("Forbidden");

    // `lockActiveHold` took the venue lock, so the venue and the event's sessions stay current.
    // PTR-138 AC1: refuse a venue that does not meet the session's requirements.
    const venue = await loadLockedVenue(tx, hold.venueId);
    const requirements = checkSessionRequirements(venue, assignedEvent.requirements, session);

    // Release the hold first, so the overlap check cannot refuse the hold against its own ledger
    // row. PTR-138 AC4: refuse a hold window that overlaps another session of the event here.
    const releasedHold = await releaseHold(tx, id, actor.id);
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
        ...requirements,
      })
      .returning()
      .catch(rethrowDuplicate);

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
        requirements,
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

/**
 * PTR-142 AC1, AC2, AC4, AC5: Venue Staff set, extend or shorten a held hold's expiry. Record the
 * acting user and time, and tell the event's assigned Coordinator. The warning instant is stored
 * as an absolute time and this write leaves it alone, so an extension cannot move it. The hold's
 * ledger row and buffers are not touched (AC5): this function never calls `occupyVenue`.
 * Refuse an expiry that is not in the future, or that is not after the warning instant.
 */
export async function handleSetVenueHoldExpiry(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id, expiresAt } = parseVenueHoldExpiry(data);
  const stored = `${expiresAt.replace("T", " ")}:00`;

  const result = await database.transaction(async tx => {
    // Lock the event before the venue, as hold creation, conversion and the warning write do.
    const locked = await keyShareEventForHold(tx, id);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const hold = await lockHold(tx, id);
    if (hold.status !== "held") throw new ConflictError("This hold is no longer active.");
    if (stored <= venueLocalTimestamp(new Date())) {
      throw new ConflictError(VENUE_HOLD_EXPIRY_PAST_MESSAGE);
    }
    if (hold.warnAt !== null && stored <= hold.warnAt) {
      throw new ConflictError(VENUE_HOLD_EXPIRY_BEFORE_WARNING_MESSAGE);
    }
    if (hold.expiresAt === stored) return hold;

    const [updated] = await tx
      .update(venueHolds)
      .set({ expiresAt: stored, expiryChangedById: actor.id, expiryChangedAt: new Date() })
      .where(eq(venueHolds.id, id))
      .returning();

    // Holds exist only on assigned events. If that is relaxed, notify the Lead queue instead.
    if (hold.assignedCoordinatorId !== null) {
      const venue = await loadLockedVenue(tx, hold.venueId);
      await raiseNotifications(tx, [
        {
          recipientId: hold.assignedCoordinatorId,
          eventRequestId: hold.eventId,
          kind: "venue_hold_expiry_changed",
          payload: {
            venueHoldId: id,
            venueId: hold.venueId,
            venueName: venue.name,
            startsAt: hold.startsAt,
            endsAt: hold.endsAt,
            action:
              hold.expiresAt === null ? "set" : stored > hold.expiresAt ? "extended" : "shortened",
            expiresAt: stored,
            previousExpiresAt: hold.expiresAt,
            warnAt: hold.warnAt,
          },
        },
      ]);
    } else {
      log.warn("No Coordinator to notify of the hold expiry", { holdId: id });
    }
    return updated;
  });

  return result;
}

/**
 * PTR-142 AC3: the event's assigned Coordinator sets the hold's warning instant, or clears it with
 * `null`. It is an absolute time with no system default. It must come before the expiry, if one
 * is set. Like the expiry write, it leaves the ledger row alone.
 */
export async function handleSetVenueHoldWarning(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id, warnAt } = parseVenueHoldWarning(data);
  const stored = warnAt === null ? null : `${warnAt.replace("T", " ")}:00`;

  return database.transaction(async tx => {
    const locked = await keyShareEventForHold(tx, id);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const hold = await lockHold(tx, id);
    if (hold.assignedCoordinatorId !== actor.id) throw new AuthorizationError("Forbidden");
    if (hold.status !== "held") throw new ConflictError("This hold is no longer active.");
    if (stored !== null) {
      if (hold.expiresAt === null) {
        throw new ConflictError(VENUE_HOLD_WARNING_NEEDS_EXPIRY_MESSAGE);
      }
      if (stored <= venueLocalTimestamp(new Date())) {
        throw new ConflictError(VENUE_HOLD_WARNING_PAST_MESSAGE);
      }
      if (stored >= hold.expiresAt) {
        throw new ConflictError(VENUE_HOLD_WARNING_ORDER_MESSAGE);
      }
    }
    const [updated] = await tx
      .update(venueHolds)
      .set({ warnAt: stored })
      .where(eq(venueHolds.id, id))
      .returning();
    return updated;
  });
}
