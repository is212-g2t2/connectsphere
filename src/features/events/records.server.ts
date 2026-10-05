import { and, eq, exists, gt, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  eventRegistrations,
  eventRequests,
  venueHolds,
  venueRequests,
  venues,
} from "#/db/schema";
import { user as userTable } from "#/db/auth-schema";
import { RoleSchema } from "#/features/auth/schema/role";
import { AuthorizationError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  eventTiming,
  getEventAccess,
  isEquipmentQueueRow,
  isPublishedForAttendees,
  isVenueQueueRow,
  projectEvent,
} from "#/features/events/access";
import type {
  EquipmentLineProjection,
  EventConfirmation,
  EventPlaces,
  EventProjection,
  EventVenueRequest,
  VipAttendee,
} from "#/features/events/access";
import { registrationCounts } from "#/features/events/register.server";
import { placeLimit } from "#/features/events/registration";
import { completionRefusal, singaporeLocalEndHasPassed } from "#/features/events/completion";
import type { VenueRequestOutcome } from "#/features/venue-requests/records.server";
import { parseEventListInput } from "#/features/events/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { loadVenueRequestOutcomesForEvents } from "#/features/venue-requests/records.server";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach. `server-fns.ts`
 * reaches this through a dynamic `import()` inside `.handler()`.
 *
 * The middleware pipeline has already verified the session before this runs. Which events a
 * caller is connected to is data rather than a role permission, so the scoping lives here and in
 * `access.ts`, not in a `requirePermission`.
 */

type Database = typeof Db;

/**
 * The caller's own event request, read through the gate both venue callers apply: the event must
 * be assigned to the Coordinator asking and stand at one of the statuses the caller works in —
 * `submitted` alone for raising a venue request (PTR-31), the wider set an assigned Coordinator
 * searches from (PTR-30). Two application callers reach it — the venue search that prefills the
 * request form and the request create handler — so it lives here with the event reads. `null` is
 * the refusal both callers turn into `AuthorizationError("Forbidden")`.
 */
export async function loadAssignedEvent(
  database: Pick<Database, "select">,
  eventId: number,
  coordinatorId: string,
  statuses: readonly EventRequestStatus[]
) {
  const rows = await database
    .select({
      id: eventRequests.id,
      name: eventRequests.eventName,
      proposedDates: eventRequests.proposedDates,
      expectedAttendance: eventRequests.expectedAttendance,
      roomLayoutPreference: eventRequests.roomLayoutPreference,
      accessibilityRequirements: eventRequests.accessibilityRequirements,
      venueRequirements: eventRequests.venueRequirements,
    })
    .from(eventRequests)
    .where(
      and(
        eq(eventRequests.id, eventId),
        inArray(eventRequests.status, [...statuses]),
        eq(eventRequests.assignedCoordinatorId, coordinatorId)
      )
    )
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * The one SQL statement of PTR-8's relationship rule: the event requests a caller is connected
 * to. `handleListEvents` filters the event list through it, and the notifications inbox reuses it
 * to decide whether a notification's subject is still reachable (PTR-55 AC5). `undefined` is an
 * unknown or missing role, which is granted nothing rather than everything.
 *
 * Every branch is scoped in SQL: the four internal roles see every non-draft status, while a
 * browsing attendee sees a `confirmed` event with registration enabled (PTR-44, superseding
 * PTR-8's `submitted` stand-in — the live window is not a visibility gate), and an existing
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
    case "venue_staff":
      // PTR-31: an unassigned `pending` row is the shared queue, so it connects every Venue Staff member to the event; an assigned row connects only the staff it names. `isVenueQueueRow` in `access.ts` states the same rule for the in-memory readers below.
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
      // PTR-38 AC5: an unassigned `requested` line is the shared queue, but only once the event
      // has been submitted — before that the draft belongs to the Coordinator alone. An assigned
      // row connects only the staff it names, and an unassigned `reserved` row is queueable too
      // (a deleted holder leaves the line reserved with no assignee, and its units must stay
      // releasable). `isEquipmentQueueRow` in `access.ts` states the same rule for the in-memory
      // readers below.
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
                  // Correlated semi-join: the line's event must have been submitted.
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
    default:
      // An unknown or missing role is granted nothing rather than everything.
      return undefined;
  }
}

export async function handleListEvents(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventProjection[]> {
  const { eventId } = parseEventListInput(data);
  const role = RoleSchema.safeParse(user.role).data ?? null;

  // The event is the event request (PTR-21/24's event record replaces this). Each role reaches
  // only the rows its relationship names, filtered in SQL by `connectedEventCondition`.
  const relationship = connectedEventCondition(database, user);

  const requestRows =
    relationship === undefined
      ? []
      : await database
          .select()
          .from(eventRequests)
          .where(
            eventId === undefined ? relationship : and(relationship, eq(eventRequests.id, eventId))
          );

  // Naming one event means a refusal rather than an empty answer, and a row that does not exist
  // is refused the same way as one belonging to someone else — neither says whether it exists,
  // and the message carries no event data (PTR-8 criterion 5).
  if (requestRows.length === 0) {
    if (eventId !== undefined) throw new AuthorizationError("Forbidden");
    return [];
  }

  const requestIds = requestRows.map(row => row.id);
  const [venueRows, equipmentRows, registrationRows] = await Promise.all([
    database
      .select()
      .from(venueRequests)
      .where(inArray(venueRequests.eventId, requestIds))
      .orderBy(venueRequests.id),
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

  // Technical Support sees who holds each line: one batched name lookup, for that role only.
  const holderIds =
    role === "technical_support_staff"
      ? [
          ...new Set(
            equipmentRows.flatMap(row => (row.assignedStaffId ? [row.assignedStaffId] : []))
          ),
        ]
      : [];
  const holderNames = new Map<string, string>(
    holderIds.length === 0
      ? []
      : (
          await database
            .select({ id: userTable.id, name: userTable.name })
            .from(userTable)
            .where(inArray(userTable.id, holderIds))
        ).map(row => [row.id, row.name])
  );

  const completionUnavailableReasons = new Map<number, string | null>();
  if (role === "event_coordinator") {
    for (const record of requestRows) {
      if (record.status !== "confirmed") continue;
      const latestApprovedEnd = venueRows
        .filter(row => row.eventId === record.id && row.status === "approved")
        .reduce<string | null>(
          (latest, row) => (latest === null || row.endsAt > latest ? row.endsAt : latest),
          null
        );
      const { endDate, endTime } = eventTiming(record.proposedDates);
      const eventEnd = endDate && endTime ? `${endDate}T${endTime}` : null;
      completionUnavailableReasons.set(
        record.id,
        completionRefusal({
          status: record.status,
          approvedBookingHasEnded: singaporeLocalEndHasPassed(latestApprovedEnd),
          eventHasEnded: singaporeLocalEndHasPassed(eventEnd),
        })
      );
    }
  }

  // Rejections and releases are shown only to the assigned Coordinator, so no other role pays for
  // the lookup. `venue-requests` owns which row is the event's live operational outcome.
  const venueRequestOutcomes: ReadonlyMap<number, VenueRequestOutcome> =
    role === "event_coordinator"
      ? await loadVenueRequestOutcomesForEvents(database, requestIds)
      : new Map<number, VenueRequestOutcome>();

  // PTR-24 AC3: the booking a confirmed event was confirmed against, for the roles that are
  // shown it — the organiser, the coordinator, and any attendee (PTR-44 AC2). Only an
  // approved booking counts; a released one leaves `venue` null.
  const confirmedVenues = new Map<number, NonNullable<EventConfirmation["venue"]>>();
  const venueCapacities = new Map<number, number>();
  const confirmedIds = requestRows.filter(row => row.status === "confirmed").map(row => row.id);
  if (
    confirmedIds.length > 0 &&
    (role === "event_organiser" || role === "event_coordinator" || role === "attendee")
  ) {
    const bookings = await database
      .select({
        eventId: venueRequests.eventId,
        name: venues.name,
        location: venues.location,
        maxCapacity: venues.maxCapacity,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(
        and(inArray(venueRequests.eventId, confirmedIds), eq(venueRequests.status, "approved"))
      )
      .orderBy(venueRequests.createdAt, venueRequests.id);
    // The earliest-created approved booking is chosen so the render is stable. The booking used
    // at confirmation is not stored (a PTR-24 follow-up), so a booking approved after
    // confirmation can change which venue shows.
    for (const booking of bookings) {
      if (!confirmedVenues.has(booking.eventId)) {
        confirmedVenues.set(booking.eventId, {
          name: booking.name,
          location: booking.location,
          date: booking.startsAt.slice(0, 10),
          endDate: booking.endsAt.slice(0, 10),
          startTime: booking.startsAt.slice(11, 16),
          endTime: booking.endsAt.slice(11, 16),
        });
        venueCapacities.set(booking.eventId, booking.maxCapacity);
      }
    }
  }

  // PTR-45 AC10: an attendee sees how many places each confirmed event has taken. The VIPs
  // (PTR-111) are counted apart, because they take venue places only.
  const registeredCounts = new Map<number, { registered: number; vips: number }>(
    role === "attendee" && confirmedIds.length > 0
      ? (
          await database
            .select({ eventId: eventRegistrations.eventId, ...registrationCounts })
            .from(eventRegistrations)
            .where(
              and(
                inArray(eventRegistrations.eventId, confirmedIds),
                eq(eventRegistrations.status, "registered")
              )
            )
            .groupBy(eventRegistrations.eventId)
        ).map(row => [row.eventId, { registered: row.registered, vips: row.vips }])
      : []
  );

  // PTR-111 AC4: the Organiser and the assigned Coordinator see each published event's VIP
  // registrations apart from the normal ones.
  const vipRegistrations = new Map<number, VipAttendee[]>();
  if (role === "event_organiser" || role === "event_coordinator") {
    for (const row of requestRows) {
      if (isPublishedForAttendees(row)) vipRegistrations.set(row.id, []);
    }
  }
  if (vipRegistrations.size > 0) {
    const vipRows = await database
      .select({
        eventId: eventRegistrations.eventId,
        attendeeId: eventRegistrations.attendeeId,
        name: userTable.name,
        email: userTable.email,
      })
      .from(eventRegistrations)
      .innerJoin(userTable, eq(userTable.id, eventRegistrations.attendeeId))
      .where(
        and(
          inArray(eventRegistrations.eventId, [...vipRegistrations.keys()]),
          eq(eventRegistrations.vip, true),
          eq(eventRegistrations.status, "registered")
        )
      )
      .orderBy(eventRegistrations.registeredAt, eventRegistrations.attendeeId);
    for (const { eventId: id, ...vip } of vipRows) vipRegistrations.get(id)?.push(vip);
  }

  // PTR-36 criterion 4: which pending requests overlap an approved booking for the same venue.
  // A self-join rather than a per-request read, and deliberately not scoped to `venueRows`: the
  // approved booking can belong to an event the caller cannot see. Only the conflict kind reaches
  // the client, never the other event. An active hold conflicts the same way (the staff queue's
  // "Conflicting hold"), so a second join flags those too.
  const pendingRows = venueRows.filter(row => row.status === "pending");
  const conflictKinds = new Map<string, "booking" | "hold">();
  if (pendingRows.length > 0) {
    const approved = alias(venueRequests, "approved_booking");
    const pendingIds = pendingRows.map(row => row.id);
    const [bookingConflicts, holdConflicts] = await Promise.all([
      database
        .select({ id: venueRequests.id })
        .from(venueRequests)
        .innerJoin(
          approved,
          and(
            eq(approved.venueId, venueRequests.venueId),
            eq(approved.status, "approved"),
            lt(venueRequests.startsAt, approved.endsAt),
            gt(venueRequests.endsAt, approved.startsAt)
          )
        )
        .where(
          and(
            inArray(venueRequests.id, pendingIds),
            // The id list was captured in an earlier statement; a row approved since then would
            // otherwise self-join (a period always overlaps itself) and flag as conflicting.
            eq(venueRequests.status, "pending")
          )
        ),
      database
        .select({ id: venueRequests.id })
        .from(venueRequests)
        .innerJoin(
          venueHolds,
          and(
            eq(venueHolds.venueId, venueRequests.venueId),
            eq(venueHolds.status, "held"),
            lt(venueRequests.startsAt, venueHolds.endsAt),
            gt(venueRequests.endsAt, venueHolds.startsAt)
          )
        )
        .where(and(inArray(venueRequests.id, pendingIds), eq(venueRequests.status, "pending"))),
    ]);
    for (const row of bookingConflicts) conflictKinds.set(row.id, "booking");
    for (const row of holdConflicts) {
      // A booking outranks a hold for the same row, matching the staff queue's precedence.
      if (!conflictKinds.has(row.id)) conflictKinds.set(row.id, "hold");
    }
  }

  return requestRows.flatMap(record => {
    const ownRegistration = registrationRows.find(row => row.eventId === record.id) ?? null;

    // The shared queue, in memory: a Venue Staff member works their own rows plus every unassigned `pending` one. `isVenueQueueRow` is the rule; the relationship's SQL states it too.
    const access = getEventAccess({
      role,
      userId: user.id,
      organiserId: record.organiserId,
      assignedCoordinatorId: record.assignedCoordinatorId,
      // Only the caller's id can satisfy the access check, so a queue row contributes exactly that.
      venueStaffIds: venueRows.flatMap(row =>
        row.eventId === record.id && isVenueQueueRow(row, user.id) ? [user.id] : []
      ),
      technicalSupportIds: equipmentRows.flatMap(row =>
        row.eventId === record.id &&
        isEquipmentQueueRow(row, user.id, record.equipmentSubmittedAt !== null)
          ? [user.id]
          : []
      ),
      status: record.status,
      registrationEnabled: record.registrationEnabled,
      hasOwnRegistration: ownRegistration !== null,
    });

    if (!access) return [];

    // Every equipment line of an event the caller is connected to, not only the lines assigned
    const equipment: EquipmentLineProjection[] = equipmentRows
      .filter(row => row.eventId === record.id)
      .map(row => ({
        id: row.id,
        item: row.item,
        quantity: row.quantity,
        arrangementStatus: row.arrangementStatus,
        notes: row.notes,
        arrangementNotes: row.arrangementNotes,
        unavailableReason: row.unavailableReason,
        reservedQuantity: row.reservedQuantity,
        lastRelease:
          row.lastReleasedAt !== null && row.lastReleasedQuantity !== null
            ? {
                quantity: row.lastReleasedQuantity,
                byName: row.lastReleasedByStaffName ?? "Technical Support",
                at: row.lastReleasedAt.toISOString(),
              }
            : null,
        // Only Technical Support acts on a line, so only their copy says whether they may.
        arrangeable:
          access === "technical_support"
            ? isEquipmentQueueRow(row, user.id, record.equipmentSubmittedAt !== null)
            : undefined,
        assignedStaffName:
          access === "technical_support"
            ? (holderNames.get(row.assignedStaffId ?? "") ?? null)
            : undefined,
      }));
    // PTR-31 criterion 5: a withdrawn request leaves the card, so only a pending row is reported; no fallback to an older withdrawn request — an event with none shows no venue request. Several pending rows can sit on one event, so the card reports the newest the caller may see, by update time with the greater id string breaking a tie, the same stable rule the outcome reader uses. A Venue Staff caller sees only the rows the queue rule grants them.
    let pendingRequest: (typeof venueRows)[number] | null = null;
    for (const row of venueRows) {
      if (row.eventId !== record.id || row.status !== "pending") continue;
      if (access === "venue_staff" && !isVenueQueueRow(row, user.id)) continue;
      if (
        !pendingRequest ||
        row.updatedAt.getTime() > pendingRequest.updatedAt.getTime() ||
        (row.updatedAt.getTime() === pendingRequest.updatedAt.getTime() &&
          row.id > pendingRequest.id)
      ) {
        pendingRequest = row;
      }
    }
    // The assigned Coordinator sees the current rejection or release outcome. With a request
    // pending, the last rejection still rides along — but when more than one request is pending
    // it is not necessarily the one the rejection answered.
    const outcome = access === "coordinator" ? (venueRequestOutcomes.get(record.id) ?? null) : null;
    const conflictKind = pendingRequest ? conflictKinds.get(pendingRequest.id) : undefined;
    const venueRequest: EventVenueRequest | null = pendingRequest
      ? {
          status: pendingRequest.status,
          ...(conflictKind ? { conflict: conflictKind } : {}),
          ...(outcome?.status === "rejected" ? { rejection: outcome.rejection } : {}),
        }
      : outcome
        ? outcome
        : null;

    return [
      projectEvent(
        // Only the request's name differs from the projection's field name; `projectEvent`
        // lists its output field by field, so no other column of the row can reach a client.
        { ...record, name: record.eventName },
        access,
        ownRegistration
          ? {
              status: ownRegistration.status,
              registeredAt: ownRegistration.registeredAt.toISOString(),
            }
          : null,
        equipment,
        venueRequest,
        confirmedVenues.get(record.id) ?? null,
        eventPlaces(
          record.registrationCapacity,
          venueCapacities.get(record.id),
          registeredCounts.get(record.id) ?? { registered: 0, vips: 0 }
        ),
        vipRegistrations.get(record.id) ?? null,
        completionUnavailableReasons.get(record.id)
      ),
    ];
  });
}

/** The places of an event with a registration capacity and a confirmed venue, else none. */
function eventPlaces(
  registrationCapacity: number | null,
  venueCapacity: number | undefined,
  counts: { registered: number; vips: number }
): EventPlaces | null {
  if (registrationCapacity === null || venueCapacity === undefined) return null;
  return {
    registered: counts.registered,
    limit: placeLimit(registrationCapacity, venueCapacity, counts.vips),
  };
}
