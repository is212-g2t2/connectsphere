import { and, asc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { eventRequests, user, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { raiseNotifications } from "#/features/notifications/raise.server";
import {
  VENUE_BOOKING_NOT_APPROVED_MESSAGE,
  parseVenueAmendmentInput,
  parseVenueReleaseInput,
} from "#/features/venue-requests/schema";
import { occupyVenue, vacateVenue } from "#/features/venue-requests/occupancy.server";
import { selectVenueRequestEntries } from "#/features/venue-requests/records.server";
import {
  assertNoEventOverlap,
  checkVenueTakesBooking,
  loadLockedVenue,
} from "#/features/venue-requests/requests.server";
import {
  assertSameVenue,
  keyShareEventForRequest,
  lockVenue,
  lockVenueForRequest,
  previewVenueForRequest,
} from "#/features/venue-requests/venue-lock.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { logger } from "#/lib/logger";

type Database = typeof Db;

const log = logger.getChild("venue-bookings");
const assignedCoordinator = alias(user, "assigned_coordinator");
const requestingCoordinator = alias(user, "requesting_coordinator");

interface BookingChangeNotice {
  eventId: number;
  eventName: string;
  requesterId: string | null;
  coordinatorId: string | null;
  venueName: string;
  startsAt: string;
  endsAt: string;
  previousVenueName?: string;
  previousStartsAt?: string;
  previousEndsAt?: string;
}

async function loadBookingChangeNotice(
  database: Pick<Database, "select">,
  id: string
): Promise<BookingChangeNotice | undefined> {
  const [notice] = await database
    .select({
      eventId: venueRequests.eventId,
      eventName: eventRequests.eventName,
      requesterId: requestingCoordinator.id,
      coordinatorId: assignedCoordinator.id,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
    })
    .from(venueRequests)
    .innerJoin(eventRequests, eq(eventRequests.id, venueRequests.eventId))
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .leftJoin(requestingCoordinator, eq(requestingCoordinator.id, venueRequests.requestedById))
    .leftJoin(assignedCoordinator, eq(assignedCoordinator.id, eventRequests.assignedCoordinatorId))
    .where(eq(venueRequests.id, id))
    .limit(1);
  return notice;
}

/**
 * PTR-37 AC4: Add a change notice in the transaction that changes the booking.
 * Notify the event's current assignee. If no Coordinator is assigned, notify the request raiser
 * so the notice is not lost. The worker delivers it.
 */
async function raiseBookingChangeNotification(
  tx: Pick<Database, "insert">,
  requestId: string,
  notice: BookingChangeNotice,
  action: "released" | "amended",
  reason?: string
): Promise<void> {
  const recipientId = notice.coordinatorId ?? notice.requesterId;
  if (!recipientId) {
    log.warn("No Coordinator to notify of venue booking change", { requestId, action });
    return;
  }

  await raiseNotifications(tx, [
    {
      recipientId,
      eventRequestId: notice.eventId,
      kind: "venue_booking_changed",
      payload: {
        venueRequestId: requestId,
        eventName: notice.eventName,
        action,
        venueName: notice.venueName,
        startsAt: notice.startsAt,
        endsAt: notice.endsAt,
        ...(reason !== undefined ? { reason } : {}),
        ...(notice.previousVenueName !== undefined
          ? { previousVenueName: notice.previousVenueName }
          : {}),
        ...(notice.previousStartsAt !== undefined
          ? { previousStartsAt: notice.previousStartsAt }
          : {}),
        ...(notice.previousEndsAt !== undefined ? { previousEndsAt: notice.previousEndsAt } : {}),
      },
    },
  ]);
}

/** The shared Venue Staff queue of upcoming approved bookings, ordered by venue-local time. */
export async function handleListVenueBookings(database: Database, now = new Date()) {
  const rows = await database
    .select({
      id: venueRequests.id,
      eventId: venueRequests.eventId,
      eventName: eventRequests.eventName,
      venueId: venueRequests.venueId,
      venueName: venues.name,
      assignedStaffId: venueRequests.assignedStaffId,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
    })
    .from(venueRequests)
    .innerJoin(eventRequests, eq(eventRequests.id, venueRequests.eventId))
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(
      and(
        eq(venueRequests.status, "approved"),
        gt(venueRequests.startsAt, venueLocalTimestamp(now))
      )
    )
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));

  return rows.map(row => ({
    id: row.id,
    eventId: row.eventId,
    eventName: row.eventName,
    venueId: row.venueId,
    venueName: row.venueName,
    assignedStaffId: row.assignedStaffId,
    startsAt: toLocalMinuteValue(row.startsAt),
    endsAt: toLocalMinuteValue(row.endsAt),
  }));
}

function assertActionableApprovedBooking<
  T extends { status: string; assignedStaffId: string | null },
>(row: T | undefined, actor: SessionUser): asserts row is T & { status: "approved" } {
  if (!row) throw new NotFoundError("Not Found");
  if (row.status !== "approved") throw new ConflictError(VENUE_BOOKING_NOT_APPROVED_MESSAGE);
  if (row.assignedStaffId !== null && row.assignedStaffId !== actor.id) {
    throw new AuthorizationError("Forbidden");
  }
}

function actorLabel(actor: SessionUser): string {
  return actor.name?.trim() || actor.email;
}

/**
 * Release an approved booking, retain its history, and notify its requesting Coordinator. Delete
 * its ledger rows in the same transaction, so the period is free when the release commits.
 */
export async function handleReleaseVenueBooking(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueReleaseInput(data);
  const released = await database.transaction(async tx => {
    // Lock the event before the venue. The notification insert takes this event lock through its
    // foreign key, and confirmation also locks the event before its requests.
    await keyShareEventForRequest(tx, input.id);
    const lockedVenueId = await lockVenueForRequest(tx, input.id);

    const rows = await tx
      .select({
        status: venueRequests.status,
        assignedStaffId: venueRequests.assignedStaffId,
        venueId: venueRequests.venueId,
      })
      .from(venueRequests)
      .where(eq(venueRequests.id, input.id))
      .limit(1)
      .for("update");
    const row = rows.at(0);
    assertActionableApprovedBooking(row, actor);
    assertSameVenue(lockedVenueId, row.venueId);

    const [updated] = await tx
      .update(venueRequests)
      .set({
        status: "released",
        releaseReason: input.reason,
        lastChangedByStaffId: actor.id,
        lastChangedByStaffName: actorLabel(actor),
        lastChangedAt: new Date(),
      })
      .where(eq(venueRequests.id, input.id))
      .returning();
    await vacateVenue(tx, { venueRequestId: input.id });
    const notice = await loadBookingChangeNotice(tx, input.id);
    if (notice) {
      await raiseBookingChangeNotification(tx, input.id, notice, "released", input.reason);
    }
    return updated;
  });

  return released;
}

/**
 * Amend an approved booking without bypassing the overlap guarantee. PTR-134 AC3: delete the
 * booking's ledger rows and insert a new one with the target venue's current buffers. Never edit a
 * row in place.
 *
 * PTR-138: an amendment is a new booking at the target venue and window, so it gets approval's
 * checks (`checkVenueTakesBooking`) with the booking's own session requirements. It also gets the
 * same-event overlap rule (`assertNoEventOverlap`), so it cannot overlap the event's pending
 * request at the target venue.
 */
export async function handleAmendVenueBooking(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueAmendmentInput(data);
  const startsAt = `${input.date} ${input.startTime}:00`;
  const endsAt = `${input.date} ${input.endTime}:00`;

  return database.transaction(async tx => {
    // Lock the event before the venues. The notification insert takes this lock through its
    // foreign key, and confirmation also locks the event before its requests.
    await keyShareEventForRequest(tx, input.id);
    const currentVenueId = await previewVenueForRequest(tx, input.id);

    // The preview took no lock. Lock venues in sorted order so crossed amendments cannot
    // deadlock while each waits for the other's second lock.
    const venueIds = [...new Set([currentVenueId, input.venueId])].toSorted((a, b) => a - b);
    for (const venueId of venueIds) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- every transaction takes locks in this order
      await lockVenue(tx, venueId);
    }

    const rows = await selectVenueRequestEntries(tx, {
      eventId: venueRequests.eventId,
      assignedStaffId: venueRequests.assignedStaffId,
    })
      .where(eq(venueRequests.id, input.id))
      .limit(1)
      .for("update", { of: venueRequests });
    const row = rows.at(0);
    assertActionableApprovedBooking(row, actor);
    assertSameVenue(currentVenueId, row.venueId);

    // Remove the booking's own rows first, so the checks below cannot refuse it against itself.
    // A refusal rolls the deletion back.
    await vacateVenue(tx, { venueRequestId: input.id });
    const venue = await loadLockedVenue(tx, input.venueId);
    const booking = { eventId: row.eventId, startsAt, endsAt, requirements: row.requirements };
    const occupancy = await checkVenueTakesBooking(tx, venue, booking);
    // The ledger check refused every booking or hold overlap. Only the event's pending requests at
    // the target venue remain for the same-event rule.
    await assertNoEventOverlap(tx, venue, booking);

    const [updated] = await tx
      .update(venueRequests)
      .set({
        venueId: input.venueId,
        startsAt,
        endsAt,
        lastChangedByStaffId: actor.id,
        lastChangedByStaffName: actorLabel(actor),
        lastChangedAt: new Date(),
      })
      .where(eq(venueRequests.id, input.id))
      .returning();
    await occupyVenue(tx, { ...occupancy, venueRequestId: input.id });
    const notice = await loadBookingChangeNotice(tx, input.id);
    if (notice) {
      await raiseBookingChangeNotification(
        tx,
        input.id,
        {
          ...notice,
          previousVenueName: row.venueName,
          previousStartsAt: row.startsAt,
          previousEndsAt: row.endsAt,
        },
        "amended"
      );
    }
    return updated;
  });
}
