import { and, asc, eq, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { eventRequests, user, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { raiseNotifications } from "#/features/notifications/raise.server";
import {
  VENUE_BOOKING_NOT_APPROVED_MESSAGE,
  VENUE_REQUEST_CONFLICT_MESSAGE,
  parseVenueAmendmentInput,
  parseVenueReleaseInput,
  venueHoldConflictMessage,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";
import {
  assertSameVenue,
  keyShareEventForRequest,
  lockVenue,
  lockVenueForRequest,
  previewVenueForRequest,
} from "#/features/venue-requests/venue-lock.server";
import { toLocalMinuteValue } from "#/features/venues/availability";
import { loadVenueBookings, loadVenueHolds } from "#/features/venues/records.server";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

type Database = typeof Db;

const log = logger.getChild("venue-bookings");
const assignedCoordinator = alias(user, "assigned_coordinator");
const requestingCoordinator = alias(user, "requesting_coordinator");

const singaporeClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function venueLocalTimestamp(now: Date): string {
  const parts = Object.fromEntries(
    singaporeClock
      .formatToParts(now)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function rethrowOverlap(error: unknown): never {
  if (isConstraintViolation(error, "venue_requests_no_overlap")) {
    throw new ConflictError(VENUE_REQUEST_CONFLICT_MESSAGE);
  }
  throw error;
}

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
 * PTR-37 AC4: the change notice to the event's current assignee, raised in the change's own
 * transaction. The request raiser is the fallback when the event has no current Coordinator, so a
 * change notice is not silently dropped. Delivery is the worker's job.
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
        sql`venue_request_occupies_venue(${venueRequests.status})`,
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

/** Release an approved booking, retain its history, and notify its requesting Coordinator. */
export async function handleReleaseVenueBooking(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueReleaseInput(data);
  const released = await database.transaction(async tx => {
    // The event key share precedes the venue lock: the notification insert below takes it through
    // its FK, and confirmation holds the event before this event's requests.
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
    const notice = await loadBookingChangeNotice(tx, input.id);
    if (notice) {
      await raiseBookingChangeNotification(tx, input.id, notice, "released", input.reason);
    }
    return updated;
  });

  return released;
}

/** Amend an approved booking without bypassing the overlap guarantee. */
export async function handleAmendVenueBooking(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueAmendmentInput(data);
  const startsAt = `${input.date} ${input.startTime}:00`;
  const endsAt = `${input.date} ${input.endTime}:00`;

  const amended = await database
    .transaction(async tx => {
      // The event key share precedes the venue locks: the notification insert below takes it
      // through its FK, and confirmation holds the event before this event's requests.
      await keyShareEventForRequest(tx, input.id);
      const currentVenueId = await previewVenueForRequest(tx, input.id);

      const venueRows = await tx
        .select({ name: venues.name })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);
      const venue = venueRows.at(0);
      if (!venue) throw new NotFoundError("Not Found");

      // The preview took no lock, so the sorted pair below is the only lock order; two
      // crossed amendments queue the same way instead of deadlocking on each other's second lock.
      const venueIds = [...new Set([currentVenueId, input.venueId])].toSorted((a, b) => a - b);
      for (const venueId of venueIds) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- every transaction takes locks in this order
        await lockVenue(tx, venueId);
      }

      const rows = await tx
        .select({
          status: venueRequests.status,
          assignedStaffId: venueRequests.assignedStaffId,
          venueId: venueRequests.venueId,
          venueName: venues.name,
          startsAt: venueRequests.startsAt,
          endsAt: venueRequests.endsAt,
        })
        .from(venueRequests)
        .innerJoin(venues, eq(venues.id, venueRequests.venueId))
        .where(eq(venueRequests.id, input.id))
        .limit(1)
        .for("update", { of: venueRequests });
      const row = rows.at(0);
      assertActionableApprovedBooking(row, actor);
      assertSameVenue(currentVenueId, row.venueId);

      const conflict = (await loadVenueBookings(tx, [input.venueId], startsAt, endsAt)).find(
        booking => booking.id !== input.id
      );
      if (conflict) {
        throw new ConflictError(
          venueRequestConflictMessage({
            venueName: venue.name,
            startsAt: conflict.startsAt,
            endsAt: conflict.endsAt,
          })
        );
      }

      const holds = await loadVenueHolds(tx, [input.venueId], startsAt, endsAt);
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
    })
    .catch(rethrowOverlap);

  return amended;
}
