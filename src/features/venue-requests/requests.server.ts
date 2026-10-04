import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { eventTiming, isVenueQueueRow } from "#/features/events/access";
import { formatProposedWindow } from "#/features/event-requests/format";
import { loadAssignedEvent } from "#/features/events/records.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import {
  VENUE_REQUEST_CONFLICT_MESSAGE,
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_DUPLICATE_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
  VENUE_REQUEST_SETTLED_MESSAGE,
  parseVenueRejectionInput,
  parseVenueRequestContext,
  parseVenueRequestId,
  parseVenueRequestInput,
  venueHoldConflictMessage,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";
import {
  assertSameVenue,
  keyShareEventForRequest,
  lockVenueForRequest,
} from "#/features/venue-requests/venue-lock.server";
import { toLocalMinuteValue } from "#/features/venues/availability";
import { loadVenueBookings, loadVenueHolds } from "#/features/venues/records.server";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach.
 * `server-fns.ts` reaches this through a dynamic `import()` inside `.handler()`.
 *
 * The middleware pipeline has already verified the session and `venue_request:request` before
 * these handlers run. Which event a caller may act on is data rather than a role permission, so
 * the assignment check lives here, next to the rows it reads.
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
 * PTR-31 criterion 4: every Venue Staff member works the shared pending queue, so every one of
 * them is told (§6: a venue booking is requested). The rows commit in the caller's transaction —
 * a rolled-back request raises nothing — and the worker delivers the emails afterwards, so a mail
 * outage cannot lose or undo the notification. An empty recipient list is the caller's to log,
 * not a refusal.
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
 * The shared shape behind both write paths' `.catch`: a constraint violation becomes the readable
 * refusal it stands for, and anything else keeps travelling as the original error.
 */
function rethrowConstraintViolation(error: unknown, constraint: string, message: string): never {
  if (isConstraintViolation(error, constraint)) {
    throw new ConflictError(message);
  }
  throw error;
}

/**
 * The partial unique index is the guarantee; a racing double-submit meets it as a driver error,
 * which `isConstraintViolation` reads. The sentence is the one the panel is built to show.
 */
export function rethrowDuplicate(error: unknown): never {
  rethrowConstraintViolation(
    error,
    "venue_requests_pending_event_venue_idx",
    VENUE_REQUEST_DUPLICATE_MESSAGE
  );
}

/**
 * Defence in depth for a writer outside `handleApproveVenueRequest`: the locked pre-check cannot
 * see a booking another connection commits between it and the update, and the constraint can. Its
 * message is the generic `VENUE_REQUEST_CONFLICT_MESSAGE`, not the named `venueRequestConflictMessage`
 * — fine while this backstop stays unreachable for callers going through this handler, where the
 * locked pre-check above already produces the named refusal.
 */
function rethrowOverlap(error: unknown): never {
  rethrowConstraintViolation(error, "venue_requests_no_overlap", VENUE_REQUEST_CONFLICT_MESSAGE);
}

/**
 * What a decision email needs, read in the decision's own transaction: the event, the venue, and
 * the address of the Coordinator who raised the request. That Coordinator is the raiser
 * (`requestedById`), not the event's current assignee; a raiser whose account is gone has no id,
 * so `requesterId` may be null.
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
 * PTR-33/PTR-34: the decision email to the Coordinator who raised the request, raised in the
 * decision's own transaction. A raiser whose account is gone has no recipient id, which is logged
 * rather than silent. Delivery is the worker's job, so no mail outage can turn a held venue or a
 * recorded rejection into a failure.
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
 * What kind of overlap a single request has, for the detail read: an approved booking outranks an
 * active hold (a booking is the answer the Coordinator most needs), and neither is `null`.
 */
async function loadConflictKind(
  database: Database,
  venueId: number,
  startsAt: string,
  endsAt: string
): Promise<"booking" | "hold" | null> {
  const [bookings, holds] = await Promise.all([
    loadVenueBookings(database, [venueId], startsAt, endsAt),
    loadVenueHolds(database, [venueId], startsAt, endsAt),
  ]);
  if (bookings.length > 0) return "booking";
  if (holds.length > 0) return "hold";
  return null;
}

function summarizePendingVenueRequest(
  row: {
    id: string;
    venueId: number;
    venueName: string;
    startsAt: string;
    endsAt: string;
    submittedAt: Date;
  },
  conflict: "booking" | "hold" | null
) {
  return {
    id: row.id,
    // The reject form's suggestion picker needs this to exclude the venue being rejected.
    venueId: row.venueId,
    venueName: row.venueName,
    startsAt: toLocalMinuteValue(row.startsAt),
    endsAt: toLocalMinuteValue(row.endsAt),
    submittedAt: row.submittedAt,
    conflict,
  };
}

// ponytail: single batched read replaces N+1 conflict lookups per row; re-batch per venue if the
// pending queue grows large.
async function pendingConflictKinds(
  database: Database,
  rows: readonly { id: string; venueId: number; startsAt: string; endsAt: string }[]
): Promise<Map<string, "booking" | "hold">> {
  if (rows.length === 0) return new Map();

  const venueIds = [...new Set(rows.map(row => row.venueId))];
  const minStart = rows.reduce(
    (min, row) => (row.startsAt < min ? row.startsAt : min),
    rows[0].startsAt
  );
  const maxEnd = rows.reduce((max, row) => (row.endsAt > max ? row.endsAt : max), rows[0].endsAt);

  const [bookings, holds] = await Promise.all([
    database
      .select({
        venueId: venueRequests.venueId,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .where(
        and(
          eq(venueRequests.status, "approved"),
          inArray(venueRequests.venueId, venueIds),
          lt(venueRequests.startsAt, maxEnd),
          gt(venueRequests.endsAt, minStart)
        )
      ),
    loadVenueHolds(database, venueIds, minStart, maxEnd),
  ]);

  const conflicts = new Map<string, "booking" | "hold">();
  for (const row of rows) {
    // The raw booking read keeps the database's `"YYYY-MM-DD HH:MM:SS"` spelling, matching the
    // row; `loadVenueHolds` normalises to the `T` spelling, so the row is normalised for it too.
    if (
      bookings.some(
        booking =>
          booking.venueId === row.venueId &&
          booking.startsAt < row.endsAt &&
          booking.endsAt > row.startsAt
      )
    ) {
      conflicts.set(row.id, "booking");
      continue;
    }
    const startsAt = row.startsAt.replace(" ", "T");
    const endsAt = row.endsAt.replace(" ", "T");
    if (
      holds.some(
        hold => hold.venueId === row.venueId && hold.startsAt < endsAt && hold.endsAt > startsAt
      )
    ) {
      conflicts.set(row.id, "hold");
    }
  }
  return conflicts;
}

/**
 * PTR-32 AC1–AC2 and AC5: the shared Venue Staff queue. The status filter and submission ordering
 * live in the reader rather than in the table component, so every caller receives all pending rows
 * (including multiple rows for one event) in one stable order. Conflict detection batches every
 * pending row through `pendingConflictKinds`, one approved-only read plus one active-hold read for
 * the whole queue rather than per-row loaders; pending and withdrawn rows never become bookings and
 * a touching boundary remains available.
 */
export async function handleListPendingVenueRequests(database: Database) {
  const rows = await database
    .select({
      id: venueRequests.id,
      venueId: venueRequests.venueId,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      submittedAt: venueRequests.createdAt,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(eq(venueRequests.status, "pending"))
    .orderBy(asc(venueRequests.createdAt), asc(venueRequests.id));

  const conflicts = await pendingConflictKinds(database, rows);
  return rows.map(row => summarizePendingVenueRequest(row, conflicts.get(row.id) ?? null));
}

/**
 * PTR-32 AC3 and TC12's refreshed contract: detail reads the current PTR-31 event requirement
 * fields, because main does not persist a requirement snapshot on `venue_requests`. It still
 * projects only venue, requested period, submission instant and operational requirements; event
 * names and conflicting-event details remain outside the Venue Staff contract.
 */
export async function handleGetPendingVenueRequest(data: unknown, database: Database) {
  const { id } = parseVenueRequestId(data);
  const rows = await database
    .select({
      id: venueRequests.id,
      venueId: venueRequests.venueId,
      venueName: venues.name,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      submittedAt: venueRequests.createdAt,
      proposedDates: eventRequests.proposedDates,
      expectedAttendance: eventRequests.expectedAttendance,
      layout: eventRequests.roomLayoutPreference,
      accessibility: eventRequests.accessibilityRequirements,
      requiredFacilities: eventRequests.venueRequirements,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .innerJoin(eventRequests, eq(eventRequests.id, venueRequests.eventId))
    .where(and(eq(venueRequests.id, id), eq(venueRequests.status, "pending")))
    .limit(1);
  const row = rows.at(0);
  // A missing row, or one that already left `pending`, is an ordinary answer the route turns into
  // its 404, matching `handleGetVenue` and `handleGetEventRequest`.
  if (!row) return null;

  const conflict = await loadConflictKind(database, row.venueId, row.startsAt, row.endsAt);

  return {
    ...summarizePendingVenueRequest(row, conflict),
    requirements: {
      eventTiming: formatProposedWindow(
        row.proposedDates.find(window => window.start !== undefined && window.end !== undefined) ??
          {}
      ),
      expectedAttendance: row.expectedAttendance,
      layout: row.layout,
      accessibility: row.accessibility,
      requiredFacilities: row.requiredFacilities,
    },
  };
}

/**
 * What the venue page's request panel needs: the caller's event defaults, and the pending request
 * for this event and venue when one exists. The event is loaded by id alone rather than filtered to
 * the current assignee, so the panel stays reachable after the event moves past `submitted` or is
 * reassigned; the caller is refused instead. Deliberately not `loadAssignedEvent`: that
 * gate requires `submitted` and the current assignee, which would take withdrawal away from a
 * raiser the moment their event moved on. Two ways a context is returned: to the Coordinator the
 * event is currently assigned to, on an event still awaiting a booking decision, or to anyone who
 * raised the pending request for this venue, whatever the event now stands at. `null` is the
 * refusal — a stranger's stale `?eventId=` leaves the venue page readable, and the difference tells
 * them nothing.
 *
 * PTR-31 criterion 2: the event part carries exactly the operational requirements the venue-staff
 * projection exposes — timing, expected attendance, layout, accessibility and required facilities
 * — so the panel can show what the request is asking of the venue. `canWithdraw` is the seam the
 * panel uses to offer withdrawal: true only while the caller raised the pending request, which is
 * what criterion 5 authorizes on.
 */
export async function handleGetVenueRequestContext(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { eventId, venueId } = parseVenueRequestContext(data);

  const eventRows = await database
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
    .limit(1);
  const event = eventRows.at(0);
  if (!event) return null;

  const requestRows = await database
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
    .limit(1);
  const request = requestRows.at(0);

  // Nothing is projected before this check, so a stranger still learns nothing: only the current
  // assignee on a submitted event, or whoever raised the pending request, gets a context back.
  const canRequest = event.assignedCoordinatorId === actor.id && event.status === "submitted";
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
 * PTR-31 criteria 1–4: the Coordinator's request becomes one `pending` row, unassigned (the
 * queue is shared), and every Venue Staff member is notified. The window is refused before the
 * insert when it does not describe a real civil day, and the event must be the submitted request
 * assigned to the caller — the gate PTR-29's venue search already applies, since the search is
 * the only way the panel is reached.
 *
 * No overlap check runs here: only an approved booking holds a venue, and pending requests stack
 * by design; the approval path refuses the overlap (PTR-36).
 */
export async function handleCreateVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueRequestInput(data);

  const created = await database.transaction(async tx => {
    const event = await loadAssignedEvent(tx, input.eventId, actor.id, ["submitted"]);
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
        // Criterion 5's authorization: the row remembers who raised it, not the event.
        requestedById: actor.id,
        // The `mode: "string"` shape the column reads back: `YYYY-MM-DD HH:MM:SS`.
        startsAt: `${input.date} ${input.startTime}:00`,
        endsAt: `${input.date} ${input.endTime}:00`,
      })
      .returning()
      .catch(rethrowDuplicate);

    // Recipients are resolved and the notification rows written in the transaction, the
    // canonical shape: the request and its notifications commit together, and the worker
    // delivers from the queue.
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
    // Nobody to tell does not refuse the request, but it must be observable rather than silent.
    log.warn("No Venue Staff to notify of the venue request", { requestId: created.request.id });
  }

  return created.request;
}

/**
 * PTR-34: a rejected request is final on every decision path (withdraw, approve, reject), so one
 * place states the refusal rather than three copies of the same `if`. Approve and reject call it
 * before their queue rule, so the sentence reaches every staff member, not only the one who
 * decided the row; each caller then checks its own "not pending" case, whose message differs.
 */
function assertNotRejected(status: string): void {
  if (status === "rejected") throw new ConflictError(VENUE_REQUEST_REJECTED_MESSAGE);
}

/**
 * PTR-31 criterion 5: the Coordinator takes back a pending request *they raised*, which leaves the
 * queue. The row is kept as `withdrawn` rather than deleted, so the record of what was asked
 * survives, and the partial unique index frees the event and venue to be requested again. A
 * settled request is refused: the approval decision (PTR-36) is not undone by withdrawing the row
 * beneath it.
 *
 * The authorization reads the request's own `requestedById`, not the event's current assignee: a
 * reassigned event must not hand the new Coordinator the power to withdraw someone else's request.
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
 * PTR-36: an approval settles a pending request *and* holds the venue for its exact period. The
 * exclusion constraint (`venue_requests_no_overlap`) is the guarantee; the advisory lock makes
 * two simultaneous approvals for one venue queue instead of deadlocking on the index, and the
 * overlap pre-check under that lock is what produces the named refusal. A writer that does not
 * come through this function still meets the constraint, whose 23P01 maps to the same conflict.
 *
 * The shared queue is every unassigned pending row (PTR-31); a row assigned to another staff
 * member is not the caller's to settle. The decision records who settled it (`assignedStaffId`),
 * which is also what keeps the event connected to that staff member afterwards.
 */
export async function handleApproveVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseVenueRequestId(data);

  const decided = await database
    .transaction(async tx => {
      // The event key share precedes every venue lock: the notification insert below takes it
      // through its FK, and confirmation holds the event before this event's requests. Then one
      // lock order for every venue writer: advisory lock first, then the row lock. The preview
      // read learns which venue to lock; the post-lock re-read must still belong to it.
      await keyShareEventForRequest(tx, id);
      const lockedVenueId = await lockVenueForRequest(tx, id);

      const rows = await tx
        .select({
          status: venueRequests.status,
          assignedStaffId: venueRequests.assignedStaffId,
          venueId: venueRequests.venueId,
          startsAt: venueRequests.startsAt,
          endsAt: venueRequests.endsAt,
        })
        .from(venueRequests)
        .where(eq(venueRequests.id, id))
        .limit(1)
        // The row lock makes the reads below current: a second approval of the same request waits
        // here and then sees the settled row — refused as rejected or decided, never handed a
        // self-conflict sentence about the request it just approved.
        .for("update");
      const row = rows.at(0);
      if (!row) throw new NotFoundError("Not Found");
      assertSameVenue(lockedVenueId, row.venueId);
      // Settled checks run before the queue rule: a decision can change who owns the row, and the
      // queue rule would otherwise answer a second staff member with a bare Forbidden instead of
      // the sentence that says the request is settled (PTR-34 AC5). `assertNotRejected` carries the
      // rejected half of that.
      assertNotRejected(row.status);
      if (row.status !== "pending") throw new ConflictError(VENUE_REQUEST_DECIDED_MESSAGE);
      if (!isVenueQueueRow(row, actor.id)) throw new AuthorizationError("Forbidden");

      // Under the lock this pre-check cannot race another approval; the constraint below is the
      // backstop for a writer that does not come through this function.
      const [conflicts, holdConflicts] = await Promise.all([
        loadVenueBookings(tx, [row.venueId], row.startsAt, row.endsAt),
        loadVenueHolds(tx, [row.venueId], row.startsAt, row.endsAt),
      ]);
      const conflict = conflicts.at(0);
      const holdConflict = holdConflicts.at(0);
      const activeConflict = conflict
        ? { message: venueRequestConflictMessage, record: conflict }
        : holdConflict
          ? { message: venueHoldConflictMessage, record: holdConflict }
          : null;
      if (activeConflict) {
        const venueRows = await tx
          .select({ name: venues.name })
          .from(venues)
          .where(eq(venues.id, row.venueId))
          .limit(1);
        throw new ConflictError(
          activeConflict.message({
            venueName: venueRows.at(0)?.name ?? "This venue",
            startsAt: activeConflict.record.startsAt,
            endsAt: activeConflict.record.endsAt,
          })
        );
      }

      // The row lock and the status check above make this the only writer of this row.
      const [approved] = await tx
        .update(venueRequests)
        .set({ status: "approved", assignedStaffId: actor.id })
        .where(eq(venueRequests.id, id))
        .returning();

      // The decision and its notification commit together; the worker sends the email.
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
    })
    .catch(rethrowOverlap);

  return decided;
}

/**
 * PTR-34: Venue Staff settle a pending request by rejecting it with a reason, and may attach a
 * suggested alternative (venue, date or time, each optional). It follows the approval's row lock
 * and queue rule, so an approval and a rejection racing for one request settle it exactly once. No
 * venue lock is needed: a rejection holds nothing, and the exclusion constraint only reads
 * `approved`. The raising Coordinator's notification is raised with the rejection; the worker
 * delivers it.
 *
 * A rejected request is final: approving, withdrawing or rejecting it again is refused with the
 * sentence that tells the Coordinator to raise a new request. The partial unique index covers only
 * pending rows, so raising one is always open.
 */
export async function handleRejectVenueRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueRejectionInput(data);

  const rejected = await database.transaction(async tx => {
    // Same event-before-venue order as approval: the notification insert below key-shares the
    // event through its FK, and confirmation holds the event before this event's requests.
    await keyShareEventForRequest(tx, input.id);
    const rows = await tx
      .select({ status: venueRequests.status, assignedStaffId: venueRequests.assignedStaffId })
      .from(venueRequests)
      .where(eq(venueRequests.id, input.id))
      .limit(1)
      .for("update");
    const row = rows.at(0);
    if (!row) throw new NotFoundError("Not Found");
    // Same order as approval: settled before queue rule, so a second staff member's stale form
    // gets the settled sentence rather than a bare Forbidden (PTR-34 AC5).
    assertNotRejected(row.status);
    if (row.status !== "pending") throw new ConflictError(VENUE_REQUEST_DECIDED_MESSAGE);
    if (!isVenueQueueRow(row, actor.id)) throw new AuthorizationError("Forbidden");

    // The suggestion is optional, but a venue it names must exist; the same refusal a request for
    // a missing venue gets, and the name is what the email shows.
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

    // The rejection and its notification commit together; the worker sends the email.
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
