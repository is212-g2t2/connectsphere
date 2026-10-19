import { and, asc, eq, exists, inArray, isNotNull, isNull, ne, notExists, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  eventRegistrations,
  eventRequests,
  safetyReviews,
  venueOccupancy,
  venueRequests,
  venues,
} from "#/db/schema";
import {
  bookingPeriod,
  selectEquipmentBookings,
} from "#/features/equipment-requests/bookings.server";
import { parseUtcTimestamp } from "#/features/equipment-requests/availability";
import { user as userTable } from "#/db/auth-schema";
import { RoleSchema } from "#/features/auth/schema/role";
import { AuthorizationError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  getEventAccess,
  hasAttendeePage,
  isEquipmentQueueRow,
  isVenueQueueRow,
  projectEvent,
} from "#/features/events/access";
import type {
  BlockedArrangement,
  EquipmentLineProjection,
  EventPlaces,
  EventProjection,
  EventVenue,
} from "#/features/events/access";
import { registrationCounts } from "#/features/events/register.server";
import { placeLimit, registrationAvailability } from "#/features/events/registration";
import type { RegistrationAvailability } from "#/features/events/registration";
import { completionRefusalForEvent } from "#/features/events/completion";
import { parseEventListInput } from "#/features/events/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";
import {
  loadBlockedArrangements,
  suspendedPieceWhere,
} from "#/features/venues/blocked-arrangements.server";
import {
  adjustableRejectionIds,
  eventVenueRequestFromRow,
  loadPendingConflictKinds,
  selectVenueRequestEntries,
} from "#/features/venue-requests/records.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";

/**
 * Keep this module server-only. A static import would ship the database schema to the browser
 * from any route-reachable module. `server-fns.ts` loads this module dynamically inside
 * `.handler()`.
 *
 * Middleware already verified the session. A caller's connected events are data, not a role
 * permission. Scope them here and in `access.ts`, not in a `requirePermission`.
 */

type Database = typeof Db;

/**
 * The one SQL statement for PTR-8's relationship rule. It lists the event requests a caller
 * connects to. `handleListEvents` filters the event list through it, and the notifications inbox
 * reuses it to check whether a notification's subject is still reachable (PTR-55 AC5). `undefined`
 * means an unknown or missing role. Grant it no events.
 *
 * Scope every branch in SQL: the internal roles see every non-draft status, while a
 * browsing attendee sees a `confirmed` event with registration enabled (PTR-44, superseding
 * PTR-8's `submitted` stand-in). The live window is not a visibility gate, and an existing
 * registration keeps a non-draft event visible.
 */
export function connectedEventCondition(
  database: Pick<Database, "select">,
  user: Pick<SessionUser, "id" | "role">
): SQL | undefined {
  const role = RoleSchema.safeParse(user.role).data ?? null;
  const visible = ne(eventRequests.status, "draft");
  const attendeeVisible = and(
    eq(eventRequests.status, "confirmed"),
    eq(eventRequests.registrationEnabled, true)
  );

  switch (role) {
    case "event_organiser":
      return and(visible, eq(eventRequests.organiserId, user.id));
    case "event_coordinator":
      return and(visible, eq(eventRequests.assignedCoordinatorId, user.id));
    // PTR-144: the Event Coordinator Lead reaches every non-draft event, assigned or not. This is
    // the same reach `getEventAccess` grants (`access.ts`), so the list and the inbox agree.
    case "event_coordinator_lead":
      return visible;
    case "venue_staff":
      // PTR-31: An unassigned `pending` row is the shared queue. It connects every Venue Staff
      // member to the event. An assigned row connects only the named staff. `isVenueQueueRow` in
      // `access.ts` states the same rule for the in-memory readers below.
      return and(
        visible,
        inArray(
          eventRequests.id,
          database
            .select({ id: venueRequests.eventId })
            .from(venueRequests)
            .where(
              or(
                eq(venueRequests.assignedStaffId, user.id),
                and(eq(venueRequests.status, "pending"), isNull(venueRequests.assignedStaffId))
              )
            )
        )
      );
    case "technical_support_staff":
      // PTR-38 AC5: An unassigned `requested` line is the shared queue, but only after
      // submission. Before that, the draft belongs to the Coordinator alone. An assigned row
      // connects only the named staff. An unassigned `reserved` row is queueable too. A deleted
      // holder leaves the line reserved with no assignee, and its units must stay releasable.
      // `isEquipmentQueueRow` in `access.ts` states the same rule for the in-memory readers below.
      return and(
        visible,
        inArray(
          eventRequests.id,
          database
            .select({ id: equipmentRequests.eventId })
            .from(equipmentRequests)
            .where(
              or(
                eq(equipmentRequests.assignedStaffId, user.id),
                and(
                  inArray(equipmentRequests.arrangementStatus, ["requested", "reserved"]),
                  isNull(equipmentRequests.assignedStaffId),
                  // Correlated semi-join: the line's event is submitted.
                  exists(
                    database
                      .select({ one: eventRequests.id })
                      .from(eventRequests)
                      .where(
                        and(
                          eq(eventRequests.id, equipmentRequests.eventId),
                          isNotNull(eventRequests.equipmentSubmittedAt)
                        )
                      )
                  )
                )
              )
            )
        )
      );
    case "attendee":
      return or(
        attendeeVisible,
        and(
          visible,
          inArray(
            eventRequests.id,
            database
              .select({ id: eventRegistrations.eventId })
              .from(eventRegistrations)
              .where(eq(eventRegistrations.attendeeId, user.id))
          )
        )
      );
    case "safety_officer":
      // PTR-146: the review row is the relationship. Every Safety Officer reads every event with
      // a review, current or not. `getEventAccess` states the same rule for the in-memory read.
      return and(
        visible,
        inArray(
          eventRequests.id,
          database.select({ id: safetyReviews.eventRequestId }).from(safetyReviews)
        )
      );
    default:
      // An unknown or missing role gets no events.
      return undefined;
  }
}

/**
 * The event's current approved booking: its venue, capacity, and session requirements (PTR-138),
 * which the arrangement fingerprint hashes. Pick the earliest-created approved booking, so the
 * render stays stable. The confirmation booking is not stored (a PTR-24 follow-up). A booking
 * approved after confirmation can change the shown venue.
 */
export interface CurrentBooking {
  venue: EventVenue;
  maxCapacity: number;
  session: {
    expectedAttendance: number | null;
    layout: string | null;
    accessibilityRequirements: string | null;
    requiredFacilities: string | null;
  };
}

export async function loadCurrentBookings(
  database: Pick<Database, "select">,
  eventIds: number[]
): Promise<Map<number, CurrentBooking>> {
  const current = new Map<number, CurrentBooking>();
  if (eventIds.length === 0) return current;

  const bookings = await database
    .select({
      eventId: venueRequests.eventId,
      name: venues.name,
      location: venues.location,
      maxCapacity: venues.maxCapacity,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
      expectedAttendance: venueRequests.expectedAttendance,
      layout: venueRequests.layout,
      accessibilityRequirements: venueRequests.accessibilityRequirements,
      requiredFacilities: venueRequests.requiredFacilities,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(
      and(
        inArray(venueRequests.eventId, eventIds),
        eq(venueRequests.status, "approved"),
        // PTR-137: a booking a live venue block suspends is not current. A registered Attendee
        // still reaches the event in planning and sees its venue as pending (O-25).
        notExists(
          database
            .select({ id: venueOccupancy.id })
            .from(venueOccupancy)
            .where(and(suspendedPieceWhere(), eq(venueOccupancy.venueRequestId, venueRequests.id)))
        )
      )
    )
    .orderBy(venueRequests.createdAt, venueRequests.id);
  for (const booking of bookings) {
    if (current.has(booking.eventId)) continue;
    current.set(booking.eventId, {
      venue: {
        name: booking.name,
        location: booking.location,
        date: booking.startsAt.slice(0, 10),
        endDate: booking.endsAt.slice(0, 10),
        startTime: booking.startsAt.slice(11, 16),
        endTime: booking.endsAt.slice(11, 16),
      },
      maxCapacity: booking.maxCapacity,
      session: {
        expectedAttendance: booking.expectedAttendance,
        layout: booking.layout,
        accessibilityRequirements: booking.accessibilityRequirements,
        requiredFacilities: booking.requiredFacilities,
      },
    });
  }
  return current;
}

/**
 * State whether the reservation window moved from the booking's buffered window. A missing
 * booking, a missing snapshot, or a timestamp mismatch all count as moved.
 */
function windowMoved(
  row: { reservationStartsAt: string | null; reservationEndsAt: string | null },
  booking: { startsAt: string; endsAt: string } | undefined
): boolean {
  return (
    !booking ||
    row.reservationStartsAt === null ||
    row.reservationEndsAt === null ||
    parseUtcTimestamp(row.reservationStartsAt) !== parseUtcTimestamp(booking.startsAt) ||
    parseUtcTimestamp(row.reservationEndsAt) !== parseUtcTimestamp(booking.endsAt)
  );
}

export async function handleListEvents(
  data: unknown,
  user: SessionUser,
  database: Database,
  now = new Date()
): Promise<EventProjection[]> {
  const { eventId } = parseEventListInput(data);
  const role = RoleSchema.safeParse(user.role).data ?? null;

  // The event is the event request (PTR-21/24's event record replaces this). Each role reaches
  // only the rows its relationship names, filtered in SQL by `connectedEventCondition`.
  const relationship = connectedEventCondition(database, user);

  // The projection reads most event columns (see `projectEvent` in `access.ts`), so list
  // the columns it uses instead of the full row. This skips the draft jsonb columns and the
  // audit snapshots.
  const requestRows =
    relationship === undefined
      ? []
      : await database
          .select({
            id: eventRequests.id,
            organiserId: eventRequests.organiserId,
            assignedCoordinatorId: eventRequests.assignedCoordinatorId,
            status: eventRequests.status,
            eventName: eventRequests.eventName,
            description: eventRequests.description,
            proposedDates: eventRequests.proposedDates,
            expectedAttendance: eventRequests.expectedAttendance,
            venueRequirements: eventRequests.venueRequirements,
            roomLayoutPreference: eventRequests.roomLayoutPreference,
            accessibilityRequirements: eventRequests.accessibilityRequirements,
            equipmentSubmittedAt: eventRequests.equipmentSubmittedAt,
            equipmentArrangementsCompletedAt: eventRequests.equipmentArrangementsCompletedAt,
            confirmedAt: eventRequests.confirmedAt,
            confirmedByName: eventRequests.confirmedByName,
            registrationEnabled: eventRequests.registrationEnabled,
            registrationCapacity: eventRequests.registrationCapacity,
            registrationOpensAt: eventRequests.registrationOpensAt,
            registrationClosesAt: eventRequests.registrationClosesAt,
            // PTR-146: the row's own review presence. The safety arm of `connectedEventCondition`
            // states the same rule in SQL, so the in-memory access check cannot drift from it.
            hasSafetyReview: exists(
              database
                .select({ id: safetyReviews.id })
                .from(safetyReviews)
                .where(eq(safetyReviews.eventRequestId, eventRequests.id))
            ).mapWith(Boolean),
          })
          .from(eventRequests)
          .where(
            eventId === undefined ? relationship : and(relationship, eq(eventRequests.id, eventId))
          )
          .orderBy(eventRequests.id);

  // Naming one event brings a refusal, not an empty answer. Refuse a missing row and another
  // user's row in the same way. Neither reveals whether the row exists. The message carries no
  // event data (PTR-8 criterion 5).
  if (requestRows.length === 0) {
    if (eventId !== undefined) throw new AuthorizationError("Forbidden");
    return [];
  }

  const requestIds = requestRows.map(row => row.id);
  const [venueRows, equipmentRows, registrationRows] = await Promise.all([
    selectVenueRequestEntries(database, {
      eventId: venueRequests.eventId,
      assignedStaffId: venueRequests.assignedStaffId,
    })
      .where(inArray(venueRequests.eventId, requestIds))
      .orderBy(asc(venueRequests.startsAt), asc(venueRequests.id)),
    database
      .select({
        id: equipmentRequests.id,
        eventId: equipmentRequests.eventId,
        assignedStaffId: equipmentRequests.assignedStaffId,
        item: equipmentRequests.item,
        quantity: equipmentRequests.quantity,
        arrangementStatus: equipmentRequests.arrangementStatus,
        notes: equipmentRequests.notes,
        arrangementNotes: equipmentRequests.arrangementNotes,
        unavailableReason: equipmentRequests.unavailableReason,
        reservedQuantity: equipmentReservations.quantity,
        venueRequestId: equipmentReservations.venueRequestId,
        reservationStartsAt: equipmentReservations.startsAt,
        reservationEndsAt: equipmentReservations.endsAt,
        lastReleasedAt: equipmentRequests.lastReleasedAt,
        lastReleasedQuantity: equipmentRequests.lastReleasedQuantity,
        lastReleasedByStaffName: equipmentRequests.lastReleasedByStaffName,
      })
      .from(equipmentRequests)
      .leftJoin(
        equipmentReservations,
        eq(equipmentReservations.equipmentRequestId, equipmentRequests.id)
      )
      .where(inArray(equipmentRequests.eventId, requestIds))
      .orderBy(equipmentRequests.id),
    database
      .select()
      .from(eventRegistrations)
      .where(
        and(
          inArray(eventRegistrations.eventId, requestIds),
          eq(eventRegistrations.attendeeId, user.id)
        )
      ),
  ]);

  const wantsEquipmentBookings =
    user.role === "technical_support_staff" || user.role === "event_coordinator";
  const equipmentBookings = wantsEquipmentBookings
    ? await selectEquipmentBookings(database, requestIds)
    : [];
  const equipmentBookingById = new Map(equipmentBookings.map(booking => [booking.id, booking]));

  // Group child rows once. The card render below reads per event, so a map lookup
  // replaces the per-event scan.
  const equipmentByEvent = Map.groupBy(equipmentRows, row => row.eventId);
  const venueByEvent = Map.groupBy(venueRows, row => row.eventId);
  const registrationByEvent = Map.groupBy(registrationRows, row => row.eventId);

  const confirmedIds = requestRows.filter(row => row.status === "confirmed").map(row => row.id);
  const pendingIds = venueRows.flatMap(row => (row.status === "pending" ? [row.id] : []));
  // Show Technical Support who holds each line. Use one batched name lookup for that role only.
  const holderIds =
    role === "technical_support_staff"
      ? [
          ...new Set(
            equipmentRows.flatMap(row => (row.assignedStaffId ? [row.assignedStaffId] : []))
          ),
        ]
      : [];
  // PTR-24 AC3: Show the Organiser and the Coordinator the current booking of a confirmed event.
  // PTR-144: the Lead reads the confirmation too. Show an Attendee the booking for every event
  // they reach (PTR-44 AC2): published events and events they registered for (PTR-46 AC2). Count
  // the venue's places for confirmed events only. PTR-146 AC5: show the Safety Officer the
  // booking and capacity of every event under review.
  const wantsBookings =
    role === "event_organiser" ||
    role === "event_coordinator" ||
    role === "event_coordinator_lead" ||
    role === "attendee" ||
    role === "safety_officer";
  // PTR-45 AC10: Show Attendees, Organisers, and Coordinators how many places each confirmed
  // event has taken. Count VIPs (PTR-111) apart. They take venue places only.
  const wantsCounts =
    (role === "attendee" || role === "event_organiser" || role === "event_coordinator") &&
    confirmedIds.length > 0;

  // Every branch needs only `requestIds` and the rows above, so read them together.
  const holderRead =
    holderIds.length === 0
      ? Promise.resolve([])
      : database
          .select({ id: userTable.id, name: userTable.name })
          .from(userTable)
          .where(inArray(userTable.id, holderIds));
  const bookingRead = wantsBookings
    ? loadCurrentBookings(
        database,
        role === "attendee" || role === "safety_officer" ? requestIds : confirmedIds
      )
    : Promise.resolve(new Map<number, CurrentBooking>());
  const countRead = wantsCounts
    ? database
        .select({ eventId: eventRegistrations.eventId, ...registrationCounts })
        .from(eventRegistrations)
        .where(
          and(
            inArray(eventRegistrations.eventId, confirmedIds),
            eq(eventRegistrations.status, "registered")
          )
        )
        .groupBy(eventRegistrations.eventId)
    : Promise.resolve([]);
  // PTR-36 criterion 4, PTR-138 AC1: Flag pending requests that overlap the ledger or that the
  // venue cannot host. Send only the conflict kind to the client, never the other event.
  // PTR-137 AC1: the arrangements a live venue block has suspended, for the Coordinator only.
  const blockedRead =
    role === "event_coordinator"
      ? loadBlockedArrangements(database, requestIds)
      : Promise.resolve(new Map<number, BlockedArrangement[]>());
  const [holderRows, bookings, countRows, conflictKinds, blockedArrangements] = await Promise.all([
    holderRead,
    bookingRead,
    countRead,
    loadPendingConflictKinds(database, pendingIds),
    blockedRead,
  ]);

  const holderNames = new Map(holderRows.map(row => [row.id, row.name]));

  const completionUnavailableReasons = new Map<number, string | null>();
  if (role === "event_coordinator") {
    for (const record of requestRows) {
      if (record.status !== "confirmed") continue;
      completionUnavailableReasons.set(record.id, completionRefusalForEvent(record));
    }
  }

  const confirmed = new Set(confirmedIds);
  const currentVenues = new Map<number, EventVenue>();
  const venueCapacities = new Map<number, number>();
  for (const [id, booking] of bookings) {
    currentVenues.set(id, booking.venue);
    // PTR-146: the Safety Officer sees the capacity of any current booking, not only a
    // confirmed event's. The other roles read capacity through the places count.
    if (confirmed.has(id) || role === "safety_officer")
      venueCapacities.set(id, booking.maxCapacity);
  }

  const registeredCounts = new Map<number, { registered: number; vips: number }>(
    countRows.map(row => [row.eventId, { registered: row.registered, vips: row.vips }])
  );

  // PTR-50: Read the venue's wall clock in the spelling of the stored registration period.
  const venueNow = toLocalMinuteValue(venueLocalTimestamp(now));

  return requestRows.flatMap(record => {
    const ownRegistration = registrationByEvent.get(record.id)?.at(0) ?? null;
    const eventVenueRows = venueByEvent.get(record.id) ?? [];
    const eventEquipmentRows = equipmentByEvent.get(record.id) ?? [];

    // Apply the shared queue in memory. A Venue Staff member works their own rows plus every
    // unassigned `pending` one. `isVenueQueueRow` is the rule. The relationship SQL states it too.
    const access = getEventAccess({
      role,
      userId: user.id,
      organiserId: record.organiserId,
      assignedCoordinatorId: record.assignedCoordinatorId,
      // Only the caller's id can satisfy the access check. A queue row contributes exactly that id.
      venueStaffIds: eventVenueRows.some(row => isVenueQueueRow(row, user.id)) ? [user.id] : [],
      technicalSupportIds: eventEquipmentRows.some(row =>
        isEquipmentQueueRow(row, user.id, record.equipmentSubmittedAt !== null)
      )
        ? [user.id]
        : [],
      status: record.status,
      registrationEnabled: record.registrationEnabled,
      hasOwnRegistration: ownRegistration !== null,
      hasSafetyReview: record.hasSafetyReview,
    });

    if (!access) return [];

    // List every equipment line of a connected event, not only assigned lines.
    const equipment: EquipmentLineProjection[] = eventEquipmentRows.map(row => ({
      id: row.id,
      item: row.item,
      quantity: row.quantity,
      arrangementStatus: row.arrangementStatus,
      notes: row.notes,
      arrangementNotes: row.arrangementNotes,
      unavailableReason: row.unavailableReason,
      reservedQuantity: row.reservedQuantity,
      venueRequestId: row.venueRequestId,
      windowChanged:
        row.reservedQuantity !== null &&
        wantsEquipmentBookings &&
        windowMoved(row, equipmentBookingById.get(row.venueRequestId ?? "")),
      lastRelease:
        row.lastReleasedAt !== null && row.lastReleasedQuantity !== null
          ? {
              quantity: row.lastReleasedQuantity,
              byName: row.lastReleasedByStaffName ?? "Technical Support",
              at: row.lastReleasedAt.toISOString(),
            }
          : null,
      // Only Technical Support acts on a line. Only their copy states whether they may act.
      arrangeable:
        access === "technical_support"
          ? isEquipmentQueueRow(row, user.id, record.equipmentSubmittedAt !== null)
          : undefined,
      assignedStaffName:
        access === "technical_support"
          ? (holderNames.get(row.assignedStaffId ?? "") ?? null)
          : undefined,
    }));
    // The venue-request visibility rule. List one entry for each visible row, earliest window
    // first (`venueRows` arrives in that order):
    // - Coordinator: every non-withdrawn row, with its session requirements (PTR-138 AC1).
    // - Organiser: pending and approved rows only, so no rejection or release reaches them.
    // - Venue Staff: the rows that the queue rule grants (`isVenueQueueRow`). A decided row in
    //   their queue is their own, so it keeps its details.
    // `projectEvent` gives Attendees and Technical Support no `venueRequests` key.
    const visibleRows = eventVenueRows.filter(row => {
      if (row.status === "withdrawn") return false;
      if (access === "organiser") return row.status === "pending" || row.status === "approved";
      if (access === "venue_staff") return isVenueQueueRow(row, user.id);
      return access === "coordinator";
    });
    const adjustable =
      access === "coordinator" ? adjustableRejectionIds(visibleRows) : new Set<string>();
    const visibleVenueRequests = visibleRows.map(row =>
      eventVenueRequestFromRow(row, {
        conflict: conflictKinds.get(row.id),
        adjustable: adjustable.has(row.id),
        requirements: access === "coordinator",
      })
    );

    return [
      projectEvent(
        // Only the request's name differs from the projection's field name. `projectEvent` lists
        // its output field by field. No other row column can reach a client.
        { ...record, name: record.eventName },
        access,
        ownRegistration
          ? {
              status: ownRegistration.status,
              registeredAt: ownRegistration.registeredAt.toISOString(),
            }
          : null,
        equipment,
        visibleVenueRequests,
        currentVenues.get(record.id) ?? null,
        eventPlaces(
          record.registrationCapacity,
          venueCapacities.get(record.id),
          registeredCounts.get(record.id) ?? { registered: 0, vips: 0 }
        ),
        {
          completionUnavailableReason: completionUnavailableReasons.get(record.id),
          registrationAvailability:
            access === "attendee"
              ? attendeeRegistrationAvailability(
                  record,
                  venueCapacities.get(record.id),
                  registeredCounts.get(record.id) ?? { registered: 0, vips: 0 },
                  venueNow
                )
              : null,
          blockedArrangements: blockedArrangements.get(record.id) ?? [],
          venueCapacity: venueCapacities.get(record.id) ?? null,
          // PTR-146: the Safety Officer's copy states the current booking's own session
          // requirements, which the fingerprint hashes, beside the event's fields.
          sessionRequirements: bookings.get(record.id)?.session ?? null,
          equipmentBookings: equipmentBookings
            .filter(booking => booking.eventId === record.id && !booking.suspended)
            // oxlint-disable-next-line oxc/no-map-spread
            .map(booking => ({
              id: booking.id,
              venueName: booking.venueName,
              ...bookingPeriod(booking),
            })),
        }
      ),
    ];
  });
}

/** Count places for an event with a registration capacity and a confirmed venue. Else null. */
function eventPlaces(
  registrationCapacity: number | null,
  venueCapacity: number | undefined,
  counts: { registered: number; vips: number }
): EventPlaces | null {
  if (registrationCapacity === null || venueCapacity === undefined) return null;
  return {
    registered: counts.registered,
    vip: counts.vips,
    limit: placeLimit(registrationCapacity, venueCapacity, counts.vips),
    capacity: registrationCapacity,
  };
}

/**
 * PTR-50: Show an Attendee the registration state for events with an Attendee page. Read counts
 * and venue for confirmed events only. A cancelled event needs neither.
 */
function attendeeRegistrationAvailability(
  record: Pick<
    typeof eventRequests.$inferSelect,
    | "status"
    | "registrationEnabled"
    | "registrationCapacity"
    | "registrationOpensAt"
    | "registrationClosesAt"
  >,
  venueCapacity: number | undefined,
  counts: { registered: number; vips: number },
  now: string
): RegistrationAvailability | null {
  if (!hasAttendeePage(record)) return null;
  return registrationAvailability({
    status: record.status,
    registrationCapacity: record.registrationCapacity,
    registrationOpensAt: record.registrationOpensAt,
    registrationClosesAt: record.registrationClosesAt,
    now,
    registeredCount: counts.registered,
    vipCount: counts.vips,
    venueCapacity: venueCapacity ?? null,
  });
}

export async function handleListEventRegistrations(
  data: unknown,
  user: SessionUser,
  database: Database
) {
  const { id: eventId } = parseEventRequestId(data);
  const event = await database.query.eventRequests.findFirst({
    where: eq(eventRequests.id, eventId),
    columns: { organiserId: true, assignedCoordinatorId: true },
  });
  if (!event || (event.organiserId !== user.id && event.assignedCoordinatorId !== user.id))
    throw new AuthorizationError("Forbidden");

  const results = await database
    .select({
      attendeeId: eventRegistrations.attendeeId,
      name: userTable.name,
      email: userTable.email,
      vip: eventRegistrations.vip,
      registeredAt: eventRegistrations.registeredAt,
    })
    .from(eventRegistrations)
    .innerJoin(userTable, eq(eventRegistrations.attendeeId, userTable.id))
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "registered"))
    )
    .orderBy(eventRegistrations.registeredAt, eventRegistrations.attendeeId);

  return results.map(a => Object.assign({}, a, { registeredAt: a.registeredAt.toISOString() }));
}
