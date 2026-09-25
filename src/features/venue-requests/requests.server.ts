import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { createElement } from "react";

import type { db as Db } from "#/db";
import { eventRequests, user, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { VenueBookingRequestEmail } from "#/features/emails/components/venue-booking-request-email";
import { eventTiming, isVenueQueueRow } from "#/features/events/access";
import { formatProposedWindow } from "#/features/event-requests/format";
import { loadAssignedEvent } from "#/features/events/records.server";
import {
  VENUE_REQUEST_CONFLICT_MESSAGE,
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_DUPLICATE_MESSAGE,
  VENUE_REQUEST_SETTLED_MESSAGE,
  parseVenueRequestContext,
  parseVenueRequestId,
  parseVenueRequestInput,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";
import { normalizeDatabaseTimestamp } from "#/features/venues/availability";
import { loadVenueBookings } from "#/features/venues/records.server";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";
import { sendEmail } from "#/lib/mailer.server";

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

interface VenueRequestNotification {
  venueName: string;
  startsAt: string;
  endsAt: string;
  expectedAttendance: number | null;
  layout: string;
  accessibilityRequirements: string;
  requiredFacilities: string;
}

/**
 * Every Venue Staff member works the shared pending queue, so all of them are told (§6: a venue
 * booking is requested). One allSettled pass over the resolved recipients; a failure is logged
 * and swallowed, because the request is already committed and losing a notification must not undo
 * it — the best-effort shape the decision emails use.
 */
async function sendVenueRequestNotification(
  notification: VenueRequestNotification,
  recipients: string[]
) {
  const subject = `Venue booking requested: ${notification.venueName}`;
  const results = await Promise.allSettled(
    recipients.map(recipient =>
      sendEmail(
        recipient,
        subject,
        createElement(VenueBookingRequestEmail, {
          venueName: notification.venueName,
          startsAt: notification.startsAt,
          endsAt: notification.endsAt,
          expectedAttendance: notification.expectedAttendance,
          layout: notification.layout,
          accessibilityRequirements: notification.accessibilityRequirements,
          requiredFacilities: notification.requiredFacilities,
        })
      )
    )
  );
  const failed = results.filter(result => result.status === "rejected").length;
  if (failed > 0) {
    log.warn("Venue request notification failed", { failed, recipients: recipients.length });
  }
}

/**
 * The partial unique index is the guarantee; a racing double-submit meets it as a driver error,
 * which `isConstraintViolation` reads. The sentence is the one the panel is built to show.
 */
function rethrowDuplicate(error: unknown): never {
  if (isConstraintViolation(error, "venue_requests_pending_event_venue_idx")) {
    throw new ConflictError(VENUE_REQUEST_DUPLICATE_MESSAGE);
  }
  throw error;
}

/**
 * The client speaks `datetime-local` (`YYYY-MM-DDTHH:MM`), the spelling `proposedDates`
 * and `formatProposedWindow` already use; the stored seconds are display noise.
 */
function toLocalMinuteValue(value: string): string {
  return normalizeDatabaseTimestamp(value).slice(0, 16);
}

async function hasApprovedConflict(
  database: Database,
  venueId: number,
  startsAt: string,
  endsAt: string
): Promise<boolean> {
  return (await loadVenueBookings(database, [venueId], startsAt, endsAt)).length > 0;
}

function summarizePendingVenueRequest(
  row: {
    id: string;
    venueName: string;
    startsAt: string;
    endsAt: string;
    submittedAt: Date;
  },
  conflict: boolean
) {
  return {
    id: row.id,
    venueName: row.venueName,
    startsAt: toLocalMinuteValue(row.startsAt),
    endsAt: toLocalMinuteValue(row.endsAt),
    submittedAt: row.submittedAt,
    conflict,
  };
}

// ponytail: single batched read replaces N+1 loadVenueBookings per row; re-batch per venue if the
// pending queue grows large.
async function pendingConflictIds(
  database: Database,
  rows: readonly { id: string; venueId: number; startsAt: string; endsAt: string }[]
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();

  const venueIds = [...new Set(rows.map(row => row.venueId))];
  const minStart = rows.reduce(
    (min, row) => (row.startsAt < min ? row.startsAt : min),
    rows[0].startsAt
  );
  const maxEnd = rows.reduce((max, row) => (row.endsAt > max ? row.endsAt : max), rows[0].endsAt);

  const bookings = await database
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
    );

  const conflicts = new Set<string>();
  for (const row of rows) {
    if (
      bookings.some(
        booking =>
          booking.venueId === row.venueId &&
          booking.startsAt < row.endsAt &&
          booking.endsAt > row.startsAt
      )
    ) {
      conflicts.add(row.id);
    }
  }
  return conflicts;
}

/**
 * PTR-32 AC1–AC2 and AC5: the shared Venue Staff queue. The status filter and submission ordering
 * live in the reader rather than in the table component, so every caller receives all pending rows
 * (including multiple rows for one event) in one stable order. Conflict detection batches every
 * pending row through `pendingConflictIds`, one approved-only read for the whole queue rather than
 * the per-row `loadVenueBookings` from PTR-36; pending and withdrawn rows never become bookings and
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

  const conflicts = await pendingConflictIds(database, rows);
  return rows.map(row => summarizePendingVenueRequest(row, conflicts.has(row.id)));
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

  const conflict = await hasApprovedConflict(database, row.venueId, row.startsAt, row.endsAt);

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

    // Recipients are resolved in the transaction, the canonical shape; the send runs after the
    // commit so a mail outage cannot undo the request.
    const recipients = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.role, "venue_staff"));

    return {
      request: rows[0],
      venue,
      recipientEmails: recipients.map(recipient => recipient.email),
      expectedAttendance: event.expectedAttendance,
      layout: event.roomLayoutPreference,
      accessibilityRequirements: event.accessibilityRequirements,
      requiredFacilities: event.venueRequirements,
    };
  });

  if (created.recipientEmails.length === 0) {
    // Nobody to tell does not refuse the request, but it must be observable rather than silent.
    log.warn("No Venue Staff to notify of the venue request", { requestId: created.request.id });
  } else {
    // sendVenueRequestNotification settles every send through Promise.allSettled and only logs,
    // so it never rejects; the request stays committed either way.
    await sendVenueRequestNotification(
      {
        venueName: created.venue.name,
        startsAt: created.request.startsAt,
        endsAt: created.request.endsAt,
        expectedAttendance: created.expectedAttendance,
        layout: created.layout,
        accessibilityRequirements: created.accessibilityRequirements,
        requiredFacilities: created.requiredFacilities,
      },
      created.recipientEmails
    );
  }

  return created.request;
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

  try {
    return await database.transaction(async tx => {
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
        // here and then sees the settled row — refused by the queue rule or as decided, never
        // handed a self-conflict sentence about the request it just approved.
        .for("update");
      const row = rows.at(0);
      if (!row) throw new NotFoundError("Not Found");
      if (!isVenueQueueRow(row, actor.id)) throw new AuthorizationError("Forbidden");

      // Serialise per venue before touching the exclusion index: two concurrent approvals can
      // otherwise deadlock on it (Postgres documents the race) and the loser would be a fault.
      await tx.execute(sql`select pg_advisory_xact_lock(${row.venueId})`);

      if (row.status !== "pending") throw new ConflictError(VENUE_REQUEST_DECIDED_MESSAGE);

      // Under the lock this pre-check cannot race another approval; the constraint below is the
      // backstop for a writer that does not come through this function.
      const conflicts = await loadVenueBookings(tx, [row.venueId], row.startsAt, row.endsAt);
      const conflict = conflicts.at(0);
      if (conflict) {
        const venueRows = await tx
          .select({ name: venues.name })
          .from(venues)
          .where(eq(venues.id, row.venueId))
          .limit(1);
        throw new ConflictError(
          venueRequestConflictMessage({
            venueName: venueRows.at(0)?.name ?? "This venue",
            startsAt: conflict.startsAt,
            endsAt: conflict.endsAt,
          })
        );
      }

      // The row lock and the status check above make this the only writer of this row.
      const [approved] = await tx
        .update(venueRequests)
        .set({ status: "approved", assignedStaffId: actor.id })
        .where(eq(venueRequests.id, id))
        .returning();
      return approved;
    });
  } catch (error) {
    // Defence in depth for a writer outside this function: the locked pre-check cannot see a
    // booking another connection commits between it and the update, and the constraint can.
    if (!isConstraintViolation(error, "venue_requests_no_overlap")) throw error;
    throw new ConflictError(VENUE_REQUEST_CONFLICT_MESSAGE);
  }
}
