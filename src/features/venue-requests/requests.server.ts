import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user, venueOccupancy, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { eventTiming, isVenueQueueRow } from "#/features/events/access";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { assertEventAcceptsActivity } from "#/features/events/completion";
import { formatProposedWindow, formatVenuePeriod } from "#/features/event-requests/format";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import {
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_DUPLICATE_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
  VENUE_REQUEST_SETTLED_MESSAGE,
  VENUE_EVENT_STATUS_PHRASE,
  VENUE_REQUIREMENTS_PHRASE,
  VENUE_UNAVAILABLE_PHRASE,
  parseVenueRejectionInput,
  parseVenueRequestContext,
  parseVenueRequestEventInput,
  parseVenueRequestId,
  parseVenueRequestInput,
} from "#/features/venue-requests/schema";
import type {
  SessionRequirementInput,
  SessionRequirements,
} from "#/features/venue-requests/schema";
import {
  checkVenueFree,
  isHoldRow,
  occupyVenue,
  overlapsLedger,
} from "#/features/venue-requests/occupancy.server";
import {
  loadPendingConflictKinds,
  selectVenueRequestEntries,
} from "#/features/venue-requests/records.server";
import {
  assertSameVenue,
  keyShareEvent,
  keyShareEventForRequest,
  lockVenue,
  lockVenueForRequest,
} from "#/features/venue-requests/venue-lock.server";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { toLocalMinuteValue } from "#/features/venues/availability";
import {
  loadAssignedEvent,
  loadWindowAvailabilityFailures,
  requirementFailures,
} from "#/features/venues/records.server";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";
import type { OperatingHours, VenueLayout } from "#/features/venues/schema";
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

/**
 * PTR-138: approval refuses a request when its event is outside `SEARCHABLE_EVENT_STATUSES`, for
 * example after confirmation or rejection. Name the status in the words that the status badge uses.
 */
export function venueRequestEventStatusMessage(status: EventRequestStatus): string {
  const label = EVENT_REQUEST_STATUS_LABELS[status].toLowerCase();
  return `This event is ${label}, so it ${VENUE_EVENT_STATUS_PHRASE}.`;
}

/** How the same-event overlap message names the other session, by its state. */
const EVENT_SESSION_NAMES = {
  pending: "pending request",
  approved: "approved booking",
  held: "tentative hold",
} as const;

/**
 * PTR-138 AC4: refuse a window that overlaps a pending request, an approved booking or a held hold
 * of the same event at the same venue. Name that session's window and state. The setup and
 * turnaround time count between two sessions of one event, as approval counts them (ADR-7), so
 * the message says so when buffers apply. A hold names the way forward: convert it.
 */
export function venueRequestEventOverlapMessage(overlap: {
  venueName: string;
  status: keyof typeof EVENT_SESSION_NAMES;
  startsAt: string;
  endsAt: string;
  buffered: boolean;
}): string {
  const period = formatVenuePeriod(overlap.startsAt, overlap.endsAt);
  const buffers = overlap.buffered ? ", including the venue's setup and turnaround time" : "";
  const next = overlap.status === "held" ? " Convert the hold to a booking request instead." : "";
  return `This window overlaps this event's ${EVENT_SESSION_NAMES[overlap.status]} for ${overlap.venueName} on ${period}${buffers}.${next}`;
}

/**
 * PTR-138 AC1: refuse a venue that does not meet the session's requirements. List every failure
 * in the words that search uses, for example "Room B does not meet this session's requirements:
 * Holds 40; 120 needed. Missing facilities: projector."
 */
export function venueRequirementsMessage(venueName: string, failures: readonly string[]): string {
  return `${venueName} ${VENUE_REQUIREMENTS_PHRASE}: ${failures.join(". ")}.`;
}

export interface VenueRequestNotification {
  venueRequestId: string;
  eventId: number;
  venueName: string;
  startsAt: string;
  endsAt: string;
  requirements: SessionRequirements;
}

/**
 * PTR-31 criterion 4: Notify every Venue Staff member about a booking request (§6). The email
 * carries the request's session requirements (PTR-138 AC1).
 *
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
        ...notification.requirements,
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
 * The partial unique index refuses a second pending request for the same event, venue and window.
 * `assertNoEventOverlap` names a duplicate first; the index refuses one from a writer outside the
 * venue lock. Map the driver error that `isConstraintViolation` reads to the panel's message.
 */
export function rethrowDuplicate(error: unknown): never {
  rethrowConstraintViolation(
    error,
    "venue_requests_pending_event_venue_window_idx",
    VENUE_REQUEST_DUPLICATE_MESSAGE
  );
}

/** The venue row that request creation and hold conversion read under the venue lock. */
export interface LockedVenue {
  id: number;
  name: string;
  setupMinutes: number;
  turnaroundMinutes: number;
  maxCapacity: number;
  facilities: string[];
  accessibilityFeatures: string[];
  supportedLayouts: VenueLayout[];
  operatingHours: OperatingHours;
}

/**
 * Read the venue's name, current buffers, opening hours, and what it offers. Call it under the
 * venue lock, so a venue save cannot change them before the checks. Return Not Found for a missing
 * venue.
 */
export async function loadLockedVenue(tx: VenueTx, venueId: number): Promise<LockedVenue> {
  const rows = await tx
    .select({
      id: venues.id,
      name: venues.name,
      setupMinutes: venues.setupMinutes,
      turnaroundMinutes: venues.turnaroundMinutes,
      maxCapacity: venues.maxCapacity,
      facilities: venues.facilities,
      accessibilityFeatures: venues.accessibilityFeatures,
      supportedLayouts: venues.supportedLayouts,
      operatingHours: venues.operatingHours,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  const venue = rows.at(0);
  if (!venue) throw new NotFoundError("Not Found");
  return venue;
}

/**
 * PTR-138 AC1: refuse a window that the venue cannot host. Name the venue and the reason in
 * search's words, for example "Room B cannot host this window: Not open 07:00–09:00 on
 * 2027-04-20."
 */
export function venueUnavailableMessage(venueName: string, failure: string): string {
  return `${venueName} ${VENUE_UNAVAILABLE_PHRASE}: ${failure}.`;
}

/**
 * PTR-138 AC1: refuse a booking window that the venue cannot take now. Check the ledger
 * (`checkVenueFree`), then availability: refuse a window when the venue is not open then, or a
 * recorded block overlaps it (`loadWindowAvailabilityFailures`). Return the ledger row to write.
 *
 * Approval and amendment call it under the venue lock, so a venue that changed since the request
 * still gets every check. Creation does not: a block can be lifted and hours can change before
 * approval.
 */
export async function checkVenueTakesBooking(
  tx: VenueTx,
  venue: LockedVenue,
  booking: { eventId: number; startsAt: string; endsAt: string }
) {
  const occupancy = await checkVenueFree(tx, venue, booking);
  const [failure] = await loadWindowAvailabilityFailures(tx, [
    {
      venueId: venue.id,
      operatingHours: venue.operatingHours,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    },
  ]);
  if (failure) throw new ConflictError(venueUnavailableMessage(venue.name, failure.message));
  return occupancy;
}

/** The event's requirements, as `loadAssignedEvent` reads them. */
interface EventRequirementRow {
  expectedAttendance: number | null;
  roomLayoutPreference: string;
  accessibilityRequirements: string;
  venueRequirements: string;
}

/**
 * PTR-138 AC1: refuse a venue that does not meet a session's requirements. Check with the rule
 * that search applies (`requirementFailures`), and name every failure. Pass the venue that
 * `loadLockedVenue` read under the venue lock.
 */
export function assertMeetsRequirements(venue: LockedVenue, requirements: SessionRequirements) {
  const failures = requirementFailures(venue, {
    expectedAttendance: requirements.expectedAttendance ?? undefined,
    layout: requirements.layout,
    accessibility: requirements.accessibilityRequirements,
    facilities: requirements.requiredFacilities,
  });
  if (failures.length > 0) {
    throw new ConflictError(
      venueRequirementsMessage(
        venue.name,
        failures.map(failure => failure.message)
      )
    );
  }
}

/**
 * PTR-138 AC1: settle the session requirements of a new request, and refuse a venue that does
 * not meet them (`assertMeetsRequirements`). An absent value takes the event's requirement.
 * Return the values that the request stores.
 */
export function checkSessionRequirements(
  venue: LockedVenue,
  event: EventRequirementRow,
  session: SessionRequirementInput
): SessionRequirements {
  const requirements: SessionRequirements = {
    expectedAttendance: session.expectedAttendance ?? event.expectedAttendance,
    layout: session.layout ?? event.roomLayoutPreference,
    accessibilityRequirements: session.accessibilityRequirements ?? event.accessibilityRequirements,
    requiredFacilities: session.requiredFacilities ?? event.venueRequirements,
  };
  assertMeetsRequirements(venue, requirements);
  return requirements;
}

/**
 * PTR-138 AC4: refuse a window that overlaps a session of the same event at this venue. The
 * venue's setup and turnaround time count between two sessions, as approval counts them (ADR-7).
 * Name a booking first, then a hold, then the earliest pending request.
 *
 * - Approved bookings and held holds: read the event's ledger rows with their stored buffers
 *   (`overlapsLedger`), as approval does. A hold blocks its own event's request too, so the
 *   message tells the Coordinator to convert the hold.
 * - Pending requests hold no venue time, so compare both sides with the venue's current buffers.
 *   An exact pending duplicate gets `VENUE_REQUEST_DUPLICATE_MESSAGE`.
 *
 * Call it under the venue lock, so two concurrent writers for one event see each other's rows.
 * The partial unique index still refuses a duplicate from a writer outside the lock. Pending
 * requests of other events can overlap; approval checks them (PTR-36).
 */
export async function assertNoEventOverlap(
  tx: VenueTx,
  venue: LockedVenue,
  request: { eventId: number; startsAt: string; endsAt: string }
): Promise<void> {
  const venueBuffered = venue.setupMinutes + venue.turnaroundMinutes > 0;
  const committed = await tx
    .select({
      isHold: isHoldRow,
      startsAt: venueOccupancy.startsAt,
      endsAt: venueOccupancy.endsAt,
      buffered: sql<boolean>`${venueOccupancy.setupMinutes} + ${venueOccupancy.turnaroundMinutes} > 0`,
    })
    .from(venueOccupancy)
    .where(
      and(
        eq(venueOccupancy.eventId, request.eventId),
        overlapsLedger({
          venueId: venue.id,
          startsAt: request.startsAt,
          endsAt: request.endsAt,
          setupMinutes: venue.setupMinutes,
          turnaroundMinutes: venue.turnaroundMinutes,
        })
      )
    )
    .orderBy(isHoldRow, asc(venueOccupancy.startsAt))
    .limit(1);
  const booked = committed.at(0);
  if (booked) {
    throw new ConflictError(
      venueRequestEventOverlapMessage({
        venueName: venue.name,
        status: booked.isHold ? "held" : "approved",
        startsAt: booked.startsAt,
        endsAt: booked.endsAt,
        buffered: venueBuffered || booked.buffered,
      })
    );
  }

  const setup = sql`make_interval(mins => ${venue.setupMinutes}::integer)`;
  const turnaround = sql`make_interval(mins => ${venue.turnaroundMinutes}::integer)`;
  const duplicate = sql<boolean>`${venueRequests.startsAt} = ${request.startsAt}::timestamp and ${venueRequests.endsAt} = ${request.endsAt}::timestamp`;
  const pending = await tx
    .select({ duplicate, startsAt: venueRequests.startsAt, endsAt: venueRequests.endsAt })
    .from(venueRequests)
    .where(
      and(
        eq(venueRequests.eventId, request.eventId),
        eq(venueRequests.venueId, venue.id),
        eq(venueRequests.status, "pending"),
        sql`tsrange(${venueRequests.startsAt} - ${setup}, ${venueRequests.endsAt} + ${turnaround}, '[)') && tsrange(${request.startsAt}::timestamp - ${setup}, ${request.endsAt}::timestamp + ${turnaround}, '[)')`
      )
    )
    .orderBy(desc(duplicate), asc(venueRequests.startsAt))
    .limit(1);
  const overlap = pending.at(0);
  if (!overlap) return;
  if (overlap.duplicate) throw new ConflictError(VENUE_REQUEST_DUPLICATE_MESSAGE);
  throw new ConflictError(
    venueRequestEventOverlapMessage({
      venueName: venue.name,
      status: "pending",
      startsAt: overlap.startsAt,
      endsAt: overlap.endsAt,
      buffered: venueBuffered,
    })
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
 *
 * Return only the venue, period, submission time, conflict kind, and operational requirements.
 * They are the request's own requirements (PTR-138 AC1), or the event's current ones for a legacy
 * row. Do not expose event names or conflicting-event details to Venue Staff (TC12). An event
 * with no such request returns `[]`, so the answer reveals nothing about other events.
 */
export async function handleGetPendingVenueRequestsForEvent(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { eventId } = parseVenueRequestEventInput(data);
  const rows = await selectVenueRequestEntries(database, {
    assignedStaffId: venueRequests.assignedStaffId,
    proposedDates: eventRequests.proposedDates,
  })
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
    // The reject form's suggestion picker needs this to exclude the venue being rejected.
    venueId: row.venueId,
    venueName: row.venueName,
    startsAt: toLocalMinuteValue(row.startsAt),
    endsAt: toLocalMinuteValue(row.endsAt),
    submittedAt: row.createdAt,
    conflict: conflicts.get(row.id) ?? null,
    requirements: {
      eventTiming: formatProposedWindow(
        row.proposedDates.find(period => period.start !== undefined && period.end !== undefined) ??
          {}
      ),
      ...row.requirements,
    },
  }));
}

/**
 * Return event defaults and the event's requests at this venue for the venue page's request panel.
 * Load the event by id, not by current assignee. This lets the request raiser withdraw after the
 * event changes status or assignment. `loadAssignedEvent` would block withdrawal because it
 * requires an event in a searchable status assigned to the caller.
 *
 * - The current Coordinator of an event in `SEARCHABLE_EVENT_STATUSES` can request. They get every
 *   pending request and approved booking of the event at this venue, earliest window first.
 * - Any other caller gets only the pending requests that they raised, so they can withdraw them.
 * - Return `null` when the caller gets no row and cannot request. A stranger's stale `?eventId=`
 *   then leaves the venue page readable and reveals no information.
 *
 * PTR-31 criterion 2: Include the operational requirements shown to Venue Staff: timing, attendance,
 * layout, accessibility, and required facilities. The form starts from them. Each row carries its
 * own session requirements (PTR-138 AC1), so two sessions at one venue stay apart. `canWithdraw`
 * is true only on a pending request that the caller raised, as criterion 5 requires.
 */
export async function handleGetVenueRequestContext(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { eventId, venueId } = parseVenueRequestContext(data);

  // The event and its requests at this venue are independent reads.
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
    selectVenueRequestEntries(database, { requestedById: venueRequests.requestedById })
      .where(
        and(
          eq(venueRequests.eventId, eventId),
          eq(venueRequests.venueId, venueId),
          inArray(venueRequests.status, ["pending", "approved"])
        )
      )
      .orderBy(asc(venueRequests.startsAt), asc(venueRequests.endsAt), asc(venueRequests.id)),
  ]);
  const event = eventRows.at(0);
  if (!event) return null;

  // Check access before returning any data.
  const canRequest =
    event.assignedCoordinatorId === actor.id && SEARCHABLE_EVENT_STATUSES.includes(event.status);
  const visible = canRequest
    ? requestRows
    : requestRows.filter(row => row.status === "pending" && row.requestedById === actor.id);
  if (!canRequest && visible.length === 0) return null;

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
    canRequest,
    requests: visible.map(row => {
      const status = row.status === "approved" ? ("approved" as const) : ("pending" as const);
      return {
        id: row.id,
        startsAt: toLocalMinuteValue(row.startsAt),
        endsAt: toLocalMinuteValue(row.endsAt),
        status,
        // The panel tells two sessions apart by attendance and layout only.
        requirements: {
          expectedAttendance: row.requirements.expectedAttendance,
          layout: row.requirements.layout,
        },
        canWithdraw: status === "pending" && row.requestedById === actor.id,
      };
    }),
  };
}

/**
 * PTR-31 criteria 1–4: Create one unassigned `pending` row and notify all Venue Staff. Refuse a
 * window that does not describe a real civil day. The event must be in `SEARCHABLE_EVENT_STATUSES`
 * and assigned to the caller, as the PTR-29 search allows. Hold creation and conversion use the
 * same gate. A cancelled event cannot receive a request (PTR-54 AC9).
 *
 * PTR-138 AC1: store the session requirements, and refuse a venue that does not meet them
 * (`checkSessionRequirements`). Do not refuse an unavailable venue here: a block can be lifted and
 * hours can change. Approval checks availability, and the ledger checks conflicts.
 *
 * PTR-138 AC4: refuse a window that overlaps the same event's pending request, approved booking or
 * held hold at this venue (`assertNoEventOverlap`). Pending requests of other events can overlap;
 * approval checks them (PTR-36).
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
    const event = await loadAssignedEvent(tx, input.eventId, actor.id);
    if (!event) throw new AuthorizationError("Forbidden");

    // Take the venue lock after the event lock, as every venue writer does. It serializes two
    // creators for one event, so the overlap check sees the other creator's committed row.
    await lockVenue(tx, input.venueId);
    const venue = await loadLockedVenue(tx, input.venueId);
    const requirements = checkSessionRequirements(venue, event, input);
    // The column returns `YYYY-MM-DD HH:MM:SS` because it uses `mode: "string"`.
    const startsAt = `${input.date} ${input.startTime}:00`;
    const endsAt = `${input.date} ${input.endTime}:00`;
    await assertNoEventOverlap(tx, venue, { eventId: event.id, startsAt, endsAt });

    const rows = await tx
      .insert(venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: event.id,
        venueId: venue.id,
        // Criterion 5: Check the user who raised the request, not the event assignment.
        requestedById: actor.id,
        startsAt,
        endsAt,
        ...requirements,
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
        requirements,
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
 * request for the event, venue and window. Refuse settled requests; withdrawal must not undo
 * approval (PTR-36).
 *
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
 * PTR-36: Approve a pending request and reserve its venue period. Only unassigned pending rows are
 * shared (PTR-31). Do not settle a row assigned to another staff member. Store the decision-maker
 * in `assignedStaffId` to keep the event linked to that staff member.
 *
 * PTR-134 AC1: write one ledger row with the venue's current buffers in the same transaction.
 * `venue_occupancy_no_overlap` guarantees no overlap. The advisory lock serializes writers for one
 * venue and prevents an index deadlock. The locked pre-check returns a named refusal; the
 * constraint refuses a write outside the lock convention with the generic conflict message.
 *
 * PTR-138: refuse an event outside `SEARCHABLE_EVENT_STATUSES`. Refuse a booking that the venue
 * cannot take now: it fails the session's requirements (`assertMeetsRequirements`), or it is
 * closed or blocked for the window (`checkVenueTakesBooking`). A legacy request uses the event's
 * current requirements.
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

    const rows = await selectVenueRequestEntries(tx, {
      eventId: venueRequests.eventId,
      assignedStaffId: venueRequests.assignedStaffId,
    })
      .where(eq(venueRequests.id, id))
      .limit(1)
      // The row lock makes these reads current. A second approval waits, then sees the settled
      // row and gets a rejection or decided message, not an overlap message about itself. Lock
      // only the request row, not the joined event or venues.
      .for("update", { of: venueRequests });
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
    // A confirmed or rejected event takes no new booking either. Rejection stays open, so staff
    // can clear a stale request.
    if (event && !SEARCHABLE_EVENT_STATUSES.includes(event.status)) {
      throw new ConflictError(venueRequestEventStatusMessage(event.status));
    }

    const venue = await loadLockedVenue(tx, row.venueId);
    // A row from before session requirements carries the event's current requirements.
    assertMeetsRequirements(venue, row.requirements);
    const occupancy = await checkVenueTakesBooking(tx, venue, row);

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
 *
 * A rejected request is final. Refuse later approve, withdraw, or reject actions and tell the
 * Coordinator to raise a new request. The partial unique index covers pending rows, so a new
 * request can be raised.
 *
 * Do not check the event status. Staff can then clear a stale request on a confirmed or rejected
 * event, which approval refuses.
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
