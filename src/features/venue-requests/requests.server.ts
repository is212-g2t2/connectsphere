import { and, asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { eventTiming, isVenueQueueRow } from "#/features/events/access";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { assertEventAcceptsActivity } from "#/features/events/completion";
import { formatProposedWindow } from "#/features/event-requests/format";
import { loadAssignedEvent } from "#/features/events/records.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import {
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_DUPLICATE_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
  VENUE_REQUEST_SETTLED_MESSAGE,
  parseVenueRejectionInput,
  parseVenueRequestContext,
  parseVenueRequestEventInput,
  parseVenueRequestId,
  parseVenueRequestInput,
} from "#/features/venue-requests/schema";
import { checkVenueFree, occupyVenue } from "#/features/venue-requests/occupancy.server";
import { loadPendingConflictKinds } from "#/features/venue-requests/records.server";
import {
  assertSameVenue,
  keyShareEvent,
  keyShareEventForRequest,
  lockVenueForRequest,
} from "#/features/venue-requests/venue-lock.server";
import { toLocalMinuteValue } from "#/features/venues/availability";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * Keep this module server-only. A client-reachable value import of `#/db/schema` would ship the
 * full database schema to the browser. `server-fns.ts` imports it dynamically inside `.handler()`.
 * Middleware checks the session and `venue_request:request` before these handlers run. Event
 * assignment depends on row data, so check it here beside the database reads.
 */

type Database = typeof Db;

const log = logger.getChild("venue-requests");

export interface VenueRequestNotification {
  venueRequestId: string;
  eventId: number;
  venueName: string;
  startsAt: string;
  endsAt: string;
  expectedAttendance: number | null;
  layout: string;
  accessibilityRequirements: string;
  requiredFacilities: string;
}

/**
 * PTR-31 criterion 4: Notify every Venue Staff member about a booking request (§6).
 * Insert notification rows in the caller's transaction, so rollback also removes them. The worker
 * sends the emails later, so a mail outage cannot undo the request or notification.
 * The caller logs an empty recipient list; it does not refuse the request.
 */
export async function raiseVenueRequestNotifications(
  tx: Pick<Database, "insert">,
  notification: VenueRequestNotification,
  recipientIds: readonly string[]
): Promise<void> {
  await raiseNotifications(
    tx,
    recipientIds.map(recipientId => ({
      recipientId,
      eventRequestId: notification.eventId,
      kind: "venue_booking_requested" as const,
      payload: {
        venueRequestId: notification.venueRequestId,
        venueName: notification.venueName,
        startsAt: notification.startsAt,
        endsAt: notification.endsAt,
        expectedAttendance: notification.expectedAttendance,
        layout: notification.layout,
        accessibilityRequirements: notification.accessibilityRequirements,
        requiredFacilities: notification.requiredFacilities,
      },
    }))
  );
}

/**
 * Map a constraint violation to its readable refusal. Rethrow every other error unchanged.
 */
function rethrowConstraintViolation(error: unknown, constraint: string, message: string): never {
  if (isConstraintViolation(error, constraint)) {
    throw new ConflictError(message);
  }
  throw error;
}

/**
 * The partial unique index prevents duplicate requests. A racing double-submit reaches the driver
 * error that `isConstraintViolation` reads. Return the message shown by the panel.
 */
export function rethrowDuplicate(error: unknown): never {
  rethrowConstraintViolation(
    error,
    "venue_requests_pending_event_venue_idx",
    VENUE_REQUEST_DUPLICATE_MESSAGE
  );
}

/**
 * Read email data in the decision transaction: the event, venue, and the requesting Coordinator's
 * address. The requester is `requestedById`, not the event's current assignee. If the requester's
 * account is gone, `requesterId` is `null`.
 */
async function loadDecisionNotice(database: Pick<Database, "select">, id: string) {
  const [notice] = await database
    .select({
      eventId: venueRequests.eventId,
      eventName: eventRequests.eventName,
      venueName: venues.name,
      requesterId: venueRequests.requestedById,
    })
    .from(venueRequests)
    .innerJoin(eventRequests, eq(eventRequests.id, venueRequests.eventId))
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(eq(venueRequests.id, id))
    .limit(1);
  return notice;
}

/**
 * PTR-33/PTR-34: Add a decision email for the Coordinator who raised the request, in the decision
 * transaction. Log a missing recipient id if the account is gone. The worker delivers the email,
 * so a mail outage cannot undo a held venue or recorded rejection.
 */
async function raiseDecisionNotification(
  tx: Pick<Database, "insert">,
  requestId: string,
  notice: Awaited<ReturnType<typeof loadDecisionNotice>> | undefined,
  build: (context: {
    requesterId: string;
    eventRequestId: number;
    eventName: string;
    venueName: string;
  }) => NewNotification
) {
  if (!notice?.requesterId) {
    log.warn("No Coordinator to notify of the venue decision", { requestId });
    return;
  }

  await raiseNotifications(tx, [
    build({
      requesterId: notice.requesterId,
      eventRequestId: notice.eventId,
      eventName: notice.eventName,
      venueName: notice.venueName,
    }),
  ]);
}

/**
 * PTR-32 AC3, PTR-138: Read every pending request of one event that the caller's queue grants
 * (`isVenueQueueRow`), earliest window first. The Venue Staff event page decides them all from
 * this one read. Read the rows and their conflicts in batched queries, never one read per row.
 * `venue_requests` stores no requirement snapshot, so return the event's current requirements.
 * Return only the venue, requested period, submission time, and operational requirements. Do
 * not expose event names or conflicting-event details to Venue Staff (TC12). An event with no
 * such request returns `[]`, so the answer reveals nothing about other events.
 */
export async function handleGetPendingVenueRequestsForEvent(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { eventId } = parseVenueRequestEventInput(data);
  const rows = await database
    .select({
      id: venueRequests.id,
      eventId: venueRequests.eventId,
      venueId: venueRequests.venueId,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      submittedAt: venueRequests.createdAt,
      assignedStaffId: venueRequests.assignedStaffId,
      status: venueRequests.status,
      proposedDates: eventRequests.proposedDates,
      expectedAttendance: eventRequests.expectedAttendance,
      layout: eventRequests.roomLayoutPreference,
      accessibility: eventRequests.accessibilityRequirements,
      requiredFacilities: eventRequests.venueRequirements,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .innerJoin(eventRequests, eq(eventRequests.id, venueRequests.eventId))
    .where(and(eq(venueRequests.eventId, eventId), eq(venueRequests.status, "pending")))
    .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id));
  // An unassigned pending row stays readable by every staff member. A row assigned to another
  // staff member is invisible to the caller, so its venue, window, and requirements stay hidden.
  const visible = rows.filter(row => isVenueQueueRow(row, actor.id));
  const conflicts = await loadPendingConflictKinds(
    database,
    visible.map(row => row.id)
  );

  return visible.map(row => ({
    id: row.id,
    eventId: row.eventId,
    // The reject form's suggestion picker needs this to exclude the venue being rejected.
    venueId: row.venueId,
    venueName: row.venueName,
    startsAt: toLocalMinuteValue(row.startsAt),
    endsAt: toLocalMinuteValue(row.endsAt),
    submittedAt: row.submittedAt,
    conflict: conflicts.get(row.id) ?? null,
    requirements: {
      eventTiming: formatProposedWindow(
        row.proposedDates.find(period => period.start !== undefined && period.end !== undefined) ??
          {}
      ),
      expectedAttendance: row.expectedAttendance,
      layout: row.layout,
      accessibility: row.accessibility,
      requiredFacilities: row.requiredFacilities,
    },
  }));
}

/**
 * Return event defaults and the pending request for the venue page's request panel.
 * Load the event by id, not by current assignee. This lets the request raiser withdraw after the
 * event changes status or assignment. `loadAssignedEvent` would block withdrawal because it
 * requires an event in a searchable status assigned to the caller.
 * Return context to the current Coordinator while the event awaits a booking decision, or to the
 * requester while their request is pending. Return `null` otherwise. A stranger's stale `?eventId=`
 * leaves the venue page readable and reveals no information.
 *
 * PTR-31 criterion 2: Include the operational requirements shown to Venue Staff: timing, attendance,
 * layout, accessibility, and required facilities. `canWithdraw` is true only when the caller raised
 * the pending request, as criterion 5 requires.
 */
export async function handleGetVenueRequestContext(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { eventId, venueId } = parseVenueRequestContext(data);

  // The event and its pending request for this venue are independent reads.
  const [eventRows, requestRows] = await Promise.all([
    database
      .select({
        id: eventRequests.id,
        name: eventRequests.eventName,
        status: eventRequests.status,
        assignedCoordinatorId: eventRequests.assignedCoordinatorId,
        proposedDates: eventRequests.proposedDates,
        expectedAttendance: eventRequests.expectedAttendance,
        roomLayoutPreference: eventRequests.roomLayoutPreference,
        accessibilityRequirements: eventRequests.accessibilityRequirements,
        venueRequirements: eventRequests.venueRequirements,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1),
    database
      .select({
        id: venueRequests.id,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
        requestedById: venueRequests.requestedById,
      })
      .from(venueRequests)
      .where(
        and(
          eq(venueRequests.eventId, eventId),
          eq(venueRequests.venueId, venueId),
          eq(venueRequests.status, "pending")
        )
      )
      .limit(1),
  ]);
  const event = eventRows.at(0);
  if (!event) return null;

  const request = requestRows.at(0);

  // Check access before returning any data. Only the current assignee of an event in a
  // searchable status or the requester of a pending request receives context.
  const canRequest =
    event.assignedCoordinatorId === actor.id && SEARCHABLE_EVENT_STATUSES.includes(event.status);
  const raisedByCaller = request?.requestedById === actor.id;
  if (!canRequest && !raisedByCaller) return null;

  return {
    event: {
      id: event.id,
      name: event.name,
      ...eventTiming(event.proposedDates),
      expectedAttendance: event.expectedAttendance,
      layout: event.roomLayoutPreference,
      accessibilityRequirements: event.accessibilityRequirements,
      requiredFacilities: event.venueRequirements,
    },
    request: request
      ? {
          id: request.id,
          startsAt: toLocalMinuteValue(request.startsAt),
          endsAt: toLocalMinuteValue(request.endsAt),
          canWithdraw: raisedByCaller,
        }
      : null,
  };
}

/**
 * PTR-31 criteria 1–4: Create one unassigned `pending` row and notify all Venue Staff.
 * Refuse a window that does not describe a real civil day. The event must stand in a searchable
 * status and be assigned to the caller, as the PTR-29 search allows (PTR-138 D2).
 * Hold creation and conversion deliberately stay `submitted`-only.
 * Do not check overlaps here. Pending requests can overlap; approval checks them (PTR-36).
 * A cancelled event cannot receive a request (PTR-54 AC9).
 */
export async function handleCreateVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueRequestInput(data);

  const created = await database.transaction(async tx => {
    // Lock the event before creating the request. This waits for a cancellation in progress; a
    // later cancellation waits for this transaction to commit.
    const locked = await keyShareEvent(tx, input.eventId);
    if (locked?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const event = await loadAssignedEvent(tx, input.eventId, actor.id, SEARCHABLE_EVENT_STATUSES);
    if (!event) throw new AuthorizationError("Forbidden");

    const venueRows = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1);
    const venue = venueRows.at(0);
    if (!venue) throw new NotFoundError("Not Found");

    const rows = await tx
      .insert(venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: event.id,
        venueId: venue.id,
        // Criterion 5: Check the user who raised the request, not the event assignment.
        requestedById: actor.id,
        // The column returns `YYYY-MM-DD HH:MM:SS` because it uses `mode: "string"`.
        startsAt: `${input.date} ${input.startTime}:00`,
        endsAt: `${input.date} ${input.endTime}:00`,
      })
      .returning()
      .catch(rethrowDuplicate);

    // Resolve recipients and write notifications in the same transaction as the request. The
    // worker sends email from the committed queue.
    const recipients = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "venue_staff"));

    const request = rows[0];
    await raiseVenueRequestNotifications(
      tx,
      {
        venueRequestId: request.id,
        eventId: event.id,
        venueName: venue.name,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        expectedAttendance: event.expectedAttendance,
        layout: event.roomLayoutPreference,
        accessibilityRequirements: event.accessibilityRequirements,
        requiredFacilities: event.venueRequirements,
      },
      recipients.map(recipient => recipient.id)
    );

    return { request, recipientCount: recipients.length };
  });

  if (created.recipientCount === 0) {
    // Do not refuse a request when there is nobody to notify. Log the empty recipient list.
    log.warn("No Venue Staff to notify of the venue request", { requestId: created.request.id });
  }

  return created.request;
}

/**
 * PTR-34: A rejected request is final for withdraw, approve, and reject actions.
 * Check this in one place so every action uses the same refusal. Approve and reject call it before
 * checking the queue. Each action then checks its own non-pending case and message.
 */
function assertNotRejected(status: string): void {
  if (status === "rejected") throw new ConflictError(VENUE_REQUEST_REJECTED_MESSAGE);
}

/**
 * PTR-31 criterion 5: Let the Coordinator who raised a pending request withdraw it.
 * Keep the row as `withdrawn` to preserve its history. The partial unique index then allows a new
 * request for the event and venue. Refuse settled requests; withdrawal must not undo approval (PTR-36).
 * Check `requestedById`, not the event's current assignee. Reassignment must not let a new
 * Coordinator withdraw someone else's request.
 */
export async function handleWithdrawVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseVenueRequestId(data);

  return database.transaction(async tx => {
    const rows = await tx
      .select({
        status: venueRequests.status,
        requestedById: venueRequests.requestedById,
      })
      .from(venueRequests)
      .where(eq(venueRequests.id, id))
      .for("update");
    const row = rows.at(0);
    if (!row) throw new NotFoundError("Not Found");
    if (row.requestedById !== actor.id) throw new AuthorizationError("Forbidden");
    assertNotRejected(row.status);
    if (row.status !== "pending") {
      throw new ConflictError(VENUE_REQUEST_SETTLED_MESSAGE);
    }

    const [withdrawn] = await tx
      .update(venueRequests)
      .set({ status: "withdrawn" })
      .where(eq(venueRequests.id, id))
      .returning();
    return withdrawn;
  });
}

/**
 * PTR-36: Approve a pending request and reserve its venue period.
 * PTR-134 AC1: write one ledger row with the venue's current buffers in the same transaction.
 * `venue_occupancy_no_overlap` guarantees no overlap. The advisory lock serializes writers for one
 * venue and prevents an index deadlock. The locked pre-check returns a named refusal; the
 * constraint refuses a write outside the lock convention with the generic conflict message.
 * Only unassigned pending rows are shared (PTR-31). Do not settle a row assigned to another staff
 * member. Store the decision-maker in `assignedStaffId` to keep the event linked to that staff member.
 */
export async function handleApproveVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseVenueRequestId(data);

  return database.transaction(async tx => {
    // Lock the event before any venue. The notification insert takes this lock through its
    // foreign key, and confirmation also locks the event before its requests.
    // For each venue, take the advisory lock before the row lock. Read the venue first, then
    // re-read it under the lock to confirm it did not change.
    // A cancellation holds the event row. This lock waits for it, then reads the new status (PTR-54 AC9).
    const event = await keyShareEventForRequest(tx, id);
    const lockedVenueId = await lockVenueForRequest(tx, id);

    const rows = await tx
      .select({
        status: venueRequests.status,
        assignedStaffId: venueRequests.assignedStaffId,
        eventId: venueRequests.eventId,
        venueId: venueRequests.venueId,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .where(eq(venueRequests.id, id))
      .limit(1)
      // The row lock makes these reads current. A second approval waits, then sees the settled
      // row and gets a rejection or decided message, not an overlap message about itself.
      .for("update");
    const row = rows.at(0);
    if (!row) throw new NotFoundError("Not Found");
    assertSameVenue(lockedVenueId, row.venueId);
    // Check settled status before the queue. A decision can change row ownership. Otherwise,
    // another staff member would get `Forbidden` instead of the settled message (PTR-34 AC5).
    // `assertNotRejected` handles rejected rows.
    assertNotRejected(row.status);
    if (row.status !== "pending") throw new ConflictError(VENUE_REQUEST_DECIDED_MESSAGE);
    if (!isVenueQueueRow(row, actor.id)) throw new AuthorizationError("Forbidden");
    // Check event status after ownership so a probe of another member's row reveals nothing.
    assertEventAcceptsActivity(event?.status);
    // PTR-54 AC9: a cancelled event takes no new booking.
    if (event?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);

    const occupancy = await checkVenueFree(tx, {
      venueId: row.venueId,
      eventId: row.eventId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    });

    // The row lock and status check make this the only writer of the row.
    const [approved] = await tx
      .update(venueRequests)
      .set({ status: "approved", assignedStaffId: actor.id })
      .where(eq(venueRequests.id, id))
      .returning();
    await occupyVenue(tx, { ...occupancy, venueRequestId: id });

    // Commit the decision and notification together. The worker sends the email.
    const notice = await loadDecisionNotice(tx, id);
    await raiseDecisionNotification(tx, id, notice, context => ({
      recipientId: context.requesterId,
      eventRequestId: context.eventRequestId,
      kind: "venue_booking_approved",
      payload: {
        venueRequestId: id,
        eventName: context.eventName,
        venueName: context.venueName,
        startsAt: approved.startsAt,
        endsAt: approved.endsAt,
      },
    }));
    return approved;
  });
}

/**
 * PTR-34: Reject a pending request with a reason. Venue Staff may also suggest a venue, date, or
 * time. Use the approval path's row lock and queue rule, so approval and rejection settle a request
 * only once. No venue lock is needed because a pending request has no `venue_occupancy` row to
 * remove. Add a notification for the requesting Coordinator; the worker delivers it.
 * A rejected request is final. Refuse later approve, withdraw, or reject actions and tell the
 * Coordinator to raise a new request. The partial unique index covers pending rows, so a new
 * request can be raised.
 */
export async function handleRejectVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueRejectionInput(data);

  const rejected = await database.transaction(async tx => {
    // Lock the event before the venue, as in approval. The notification insert takes the event
    // lock through its foreign key, and confirmation also locks the event first.
    await keyShareEventForRequest(tx, input.id);
    const rows = await tx
      .select({ status: venueRequests.status, assignedStaffId: venueRequests.assignedStaffId })
      .from(venueRequests)
      .where(eq(venueRequests.id, input.id))
      .limit(1)
      .for("update");
    const row = rows.at(0);
    if (!row) throw new NotFoundError("Not Found");
    // Check settled status before the queue, as in approval. Another staff member's stale form
    // then gets the settled message instead of `Forbidden` (PTR-34 AC5).
    assertNotRejected(row.status);
    if (row.status !== "pending") throw new ConflictError(VENUE_REQUEST_DECIDED_MESSAGE);
    if (!isVenueQueueRow(row, actor.id)) throw new AuthorizationError("Forbidden");

    // The suggestion is optional, but any venue it names must exist. Use the same refusal as a
    // request for a missing venue; the email shows this name.
    let suggestedVenueName: string | undefined;
    if (input.suggestedVenueId !== undefined) {
      const venueRows = await tx
        .select({ name: venues.name })
        .from(venues)
        .where(eq(venues.id, input.suggestedVenueId))
        .limit(1);
      if (!venueRows[0]) throw new NotFoundError("Not Found");
      suggestedVenueName = venueRows[0].name;
    }

    const [updated] = await tx
      .update(venueRequests)
      .set({
        status: "rejected",
        assignedStaffId: actor.id,
        rejectionReason: input.reason,
        suggestedVenueId: input.suggestedVenueId ?? null,
        suggestedDate: input.suggestedDate ?? null,
        suggestedStartTime: input.suggestedStartTime ?? null,
        suggestedEndTime: input.suggestedEndTime ?? null,
      })
      .where(eq(venueRequests.id, input.id))
      .returning();

    // Commit the rejection and notification together. The worker sends the email.
    const notice = await loadDecisionNotice(tx, input.id);
    await raiseDecisionNotification(tx, input.id, notice, context => ({
      recipientId: context.requesterId,
      eventRequestId: context.eventRequestId,
      kind: "venue_booking_rejected",
      payload: {
        venueRequestId: input.id,
        eventName: context.eventName,
        venueName: context.venueName,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        reason: input.reason,
        suggestion: {
          venueName: suggestedVenueName ?? null,
          date: input.suggestedDate ?? null,
          startTime: input.suggestedStartTime ?? null,
          endTime: input.suggestedEndTime ?? null,
        },
      },
    }));

    return updated;
  });

  return rejected;
}
