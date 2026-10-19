import { and, asc, eq, ilike, inArray, notExists, or, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  eventRegistrations,
  eventRequests,
  notifications,
  user,
  venueRequests,
  venues,
  vipRegistrationChanges,
} from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { isPublishedForAttendees } from "#/features/events/access";
import type { VipAttendee } from "#/features/events/access";
import {
  ALREADY_REGISTERED_MESSAGE,
  ALREADY_WAITLISTED_MESSAGE,
  NOT_A_VIP_MESSAGE,
  NOT_WAITLISTED_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  didFreePlace,
  placeLimit,
  placeMark,
  registrationRefusal,
  totalVenueCapacity,
  venueCapacityReachedMessage,
  waitingListJoinRefusal,
} from "#/features/events/registration";
import type { PlaceCounts } from "#/features/events/registration";
import {
  VIP_SEARCH_LIMIT,
  parseVipRegistrationInput,
  parseVipSearchInput,
} from "#/features/events/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { notSuspendedByLiveBlock } from "#/features/venues/blocked-arrangements.server";

/**
 * Keep this module server-only. It imports `#/db/schema` as a value. `server-fns.ts` loads it
 * dynamically inside `.handler()`. Middleware already verified the session and `event:register`
 * or `vip_registration:manage`.
 */

type Database = typeof Db;

/**
 * Count the event's `registered` registrations as select columns: normal ones and VIPs (PTR-111)
 * apart. `records.server` counts attendee places with the same two.
 */
export const registrationCounts = {
  registered: sql<number>`count(*) filter (where not ${eventRegistrations.vip})`.mapWith(Number),
  vips: sql<number>`count(*) filter (where ${eventRegistrations.vip})`.mapWith(Number),
};

/**
 * PTR-45: An Attendee registers for a published event. Every registration for the event locks the
 * event row before it counts. Two Attendees racing for the last place queue on the row. The
 * second one counts the first (AC3).
 *
 * Commit the registration and its notifications together. The worker sends the emails.
 */
export async function handleRegisterForEvent(
  data: unknown,
  actor: SessionUser,
  database: Database,
  now = new Date()
) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const event = await readEvent(tx, input.id, { lock: true });

    // AC2: Only a published event takes registrations. Refuse a missing event and an
    // unpublished one in the same way. The refusal then reveals nothing about the id.
    if (!event || !isPublishedForAttendees(event)) throw new AuthorizationError("Forbidden");

    const bookings = await approvedBookings(tx, event.id);
    const totalCapacity = totalVenueCapacity(bookings);
    const { registered, vips } = await countRegistrations(tx, event.id);

    const refusal = registrationRefusal({
      ...event,
      now: toLocalMinuteValue(venueLocalTimestamp(now)),
      alreadyRegistered: await isRegistered(tx, event.id, actor.id),
      registeredCount: registered,
      vipCount: vips,
      venueCapacity: totalCapacity,
    });
    if (refusal) throw new ConflictError(refusal);

    // The refusal rules guarantee both values. The throw only narrows the types.
    const capacity = event.registrationCapacity;
    const booking = bookings.at(0);
    if (!booking || capacity === null || totalCapacity === null) {
      throw new Error("Registration passed without an approved booking or a capacity");
    }

    // Keep one row per Attendee and event. A withdrawn registration returns to `registered`
    // (PTR-47 AC5). A waitlisted registration does too: registering claims the freed place and
    // leaves the list (PTR-163 AC3). It returns as the Attendee's own row, even when it was a
    // removed VIP registration. Leave a `registered` row unchanged, so no row comes back (AC6).
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: actor.id })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: { status: "registered", registeredAt: sql`now()`, vip: false },
          setWhere: inArray(eventRegistrations.status, ["withdrawn", "waitlisted"]),
        })
        .returning({
          status: eventRegistrations.status,
          registeredAt: eventRegistrations.registeredAt,
        })
    ).at(0);
    if (!registration) throw new ConflictError(ALREADY_REGISTERED_MESSAGE);

    await raiseNotifications(tx, [
      {
        recipientId: actor.id,
        eventRequestId: event.id,
        kind: "event_registered",
        payload: {
          eventName: eventName(event),
          venueName: booking.venueName,
          venueLocation: booking.venueLocation,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          venues: bookings.map(row => ({
            venueName: row.venueName,
            venueLocation: row.venueLocation,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
          })),
        },
      },
    ]);
    // AC8 and AC9: Announce each threshold as the count crosses it. Only the registration that
    // reaches 90% of the place limit, or the limit itself, sends the notice.
    const limit = placeLimit(capacity, totalCapacity, vips);
    if (placeMark(registered + 1, limit)) await announcePlaceMark(tx, event, registered + 1, limit);

    return { status: registration.status, registeredAt: registration.registeredAt.toISOString() };
  });
}

/**
 * PTR-111: Find Attendee accounts by part of the name or email, case-insensitively. The Organiser
 * or the assigned Coordinator can add them as VIPs. Leave out Attendees with a registration for
 * the event. List the account with the exact typed email first. Accounts named after a guest then
 * cannot push the guest's account out of the results.
 */
export async function handleSearchVipAttendees(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<VipAttendee[]> {
  const input = parseVipSearchInput(data);
  const event = requireManagedEvent(await readEvent(database, input.id), actor);

  // `\` is the ILIKE escape character. A typed `%` or `_` matches only itself.
  const pattern = `%${input.query.replaceAll(/[\\%_]/g, "\\$&")}%`;
  return database
    .select({ attendeeId: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      and(
        eq(user.role, "attendee"),
        or(ilike(user.name, pattern), ilike(user.email, pattern)),
        notExists(
          database
            .select({ one: sql`1` })
            .from(eventRegistrations)
            .where(
              and(
                eq(eventRegistrations.eventId, event.id),
                eq(eventRegistrations.attendeeId, user.id),
                eq(eventRegistrations.status, "registered")
              )
            )
        )
      )
    )
    .orderBy(sql`${user.email} = ${input.query.toLowerCase()} desc`, user.name, user.email)
    .limit(VIP_SEARCH_LIMIT);
}

/**
 * PTR-111: The Organiser or the assigned Coordinator adds a VIP registration for an Attendee
 * account. The VIP takes the same event row lock as an Attendee's own registration. A VIP and an
 * Attendee racing for the total venue's last place queue on it (AC3). Log the acting user and
 * the time (AC5).
 */
export async function handleAddVipRegistration(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<void> {
  const input = parseVipRegistrationInput(data);

  await database.transaction(async tx => {
    const event = requireManagedEvent(await readEvent(tx, input.id, { lock: true }), actor);

    const attendee = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.attendeeId), eq(user.role, "attendee")))
    ).at(0);
    if (!attendee) throw new NotFoundError(VIP_NOT_ATTENDEE_MESSAGE);
    if (await isRegistered(tx, event.id, attendee.id)) {
      throw new ConflictError(VIP_ALREADY_REGISTERED_MESSAGE);
    }

    // AC2 and AC3: The registration capacity and period do not apply. The total venue
    // capacity on the approved bookings sets the only ceiling. With no approved booking, there
    // is no ceiling.
    const bookings = await approvedBookings(tx, event.id);
    const totalCapacity = totalVenueCapacity(bookings);
    if (totalCapacity === null) throw new ConflictError(REGISTRATION_NOT_OPEN_MESSAGE);
    const { registered, vips } = await countRegistrations(tx, event.id);
    if (registered + vips >= totalCapacity) {
      throw new ConflictError(venueCapacityReachedMessage(totalCapacity));
    }

    // Reuse the Attendee's one row for the event. A withdrawn registration of either kind
    // becomes this VIP registration, as does a waiting-list row: the Attendee leaves the list.
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: attendee.id, vip: true })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: { status: "registered", registeredAt: sql`now()`, vip: true },
          setWhere: inArray(eventRegistrations.status, ["withdrawn", "waitlisted"]),
        })
        .returning({ attendeeId: eventRegistrations.attendeeId })
    ).at(0);
    if (!registration) throw new ConflictError(VIP_ALREADY_REGISTERED_MESSAGE);
    await tx
      .insert(vipRegistrationChanges)
      .values({ eventId: event.id, attendeeId: attendee.id, change: "added", actorId: actor.id });

    // A VIP leaves normal registration one place fewer. That can move normal registrations onto
    // the 90% or full mark of the new limit. Tell the Organiser and the Coordinator then, as for a
    // normal registration that reaches the mark (PTR-45 AC8, AC9). Compare the mark value itself.
    // 9 of 10 reads as 90%. 9 of 9 reads as full.
    const capacity = event.registrationCapacity;
    if (capacity === null) {
      throw new Error("A published event passed without a registration capacity");
    }
    const after = placeLimit(capacity, totalCapacity, vips + 1);
    const mark = placeMark(registered, after);
    if (mark && mark !== placeMark(registered, placeLimit(capacity, totalCapacity, vips))) {
      await announcePlaceMark(tx, event, registered, after);
    }
  });
}

/**
 * PTR-111 AC6: The Organiser or the assigned Coordinator removes a VIP registration. It becomes
 * `withdrawn` and no longer holds a venue place. Log who removed it and when.
 */
export async function handleRemoveVipRegistration(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<void> {
  const input = parseVipRegistrationInput(data);

  await database.transaction(async tx => {
    const event = requireManagedEvent(await readEvent(tx, input.id, { lock: true }), actor);

    // Take the counts before the flip. A removed VIP drops `vips` and can open a place for the
    // waiting list while `registered` stays unchanged.
    const bookings = await approvedBookings(tx, event.id);
    const totalCapacity = totalVenueCapacity(bookings);
    const capacity = event.registrationCapacity;
    const countsBefore =
      totalCapacity !== null && capacity !== null ? await countRegistrations(tx, event.id) : null;

    const removed = await tx
      .update(eventRegistrations)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(eventRegistrations.eventId, event.id),
          eq(eventRegistrations.attendeeId, input.attendeeId),
          eq(eventRegistrations.vip, true),
          eq(eventRegistrations.status, "registered")
        )
      )
      .returning({ attendeeId: eventRegistrations.attendeeId });
    if (removed.length === 0) throw new ConflictError(NOT_A_VIP_MESSAGE);
    await tx.insert(vipRegistrationChanges).values({
      eventId: event.id,
      attendeeId: input.attendeeId,
      change: "removed",
      actorId: actor.id,
    });

    if (countsBefore !== null && totalCapacity !== null && capacity !== null) {
      const before = {
        registeredCount: countsBefore.registered,
        vipCount: countsBefore.vips,
        venueCapacity: totalCapacity,
        registrationCapacity: capacity,
      };
      if (didFreePlace(before, { ...before, vipCount: countsBefore.vips - 1 })) {
        await announcePlaceAvailable(tx, event.id, eventName(event));
      }
    }
  });
}

/**
 * Join the waiting list of a full event with an open window. The event row lock queues
 * concurrent joins with registrations and withdrawals. A withdrawn row becomes `waitlisted`;
 * a `registered` or `waitlisted` row is refused. The join raises no notice: the Attendee sees
 * the status on the event page and the dashboard.
 */
export async function handleJoinWaitingList(
  data: unknown,
  actor: SessionUser,
  database: Database,
  now = new Date()
) {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    const event = await readEvent(tx, input.id, { lock: true });

    // Only a published event takes a waiting list. Refuse a missing event and an
    // unpublished one in the same way, as registration does.
    if (!event || !isPublishedForAttendees(event)) throw new AuthorizationError("Forbidden");

    const bookings = await approvedBookings(tx, event.id);
    const totalCapacity = totalVenueCapacity(bookings);
    const { registered, vips } = await countRegistrations(tx, event.id);
    const own = await registrationStatus(tx, event.id, actor.id);

    const refusal = waitingListJoinRefusal({
      ...event,
      now: toLocalMinuteValue(venueLocalTimestamp(now)),
      alreadyRegistered: own === "registered",
      alreadyWaitlisted: own === "waitlisted",
      registeredCount: registered,
      vipCount: vips,
      venueCapacity: totalCapacity,
    });
    if (refusal) throw new ConflictError(refusal);

    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: actor.id, status: "waitlisted" })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: { status: "waitlisted", registeredAt: sql`now()`, vip: false },
          setWhere: eq(eventRegistrations.status, "withdrawn"),
        })
        .returning({
          status: eventRegistrations.status,
          registeredAt: eventRegistrations.registeredAt,
        })
    ).at(0);
    // A race with another join or registration took the row first. Name what the caller holds now.
    if (!registration) {
      throw new ConflictError(
        own === "registered" ? ALREADY_REGISTERED_MESSAGE : ALREADY_WAITLISTED_MESSAGE
      );
    }

    return { status: registration.status, registeredAt: registration.registeredAt.toISOString() };
  });
}

/**
 * Leave the waiting list. One statement flips `waitlisted` to `withdrawn`, so no event lock is
 * needed: leaving frees no place. Answer a missing row and a foreign id in the same way, so a
 * probe learns nothing about the id.
 */
export async function handleLeaveWaitingList(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<void> {
  const input = parseEventRequestId(data);

  const left = await database
    .update(eventRegistrations)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(eventRegistrations.eventId, input.id),
        eq(eventRegistrations.attendeeId, actor.id),
        eq(eventRegistrations.status, "waitlisted")
      )
    )
    .returning({ eventId: eventRegistrations.eventId });
  if (left.length === 0) throw new ConflictError(NOT_WAITLISTED_MESSAGE);
}

/** Read the event's current places: its `registered` counts and its total venue ceiling. */
export async function readPlaceState(
  tx: Pick<Database, "select">,
  eventId: number,
  registrationCapacity: number | null
): Promise<PlaceCounts> {
  const counts = await countRegistrations(tx, eventId);
  const bookings = await approvedBookings(tx, eventId);
  return {
    registeredCount: counts.registered,
    vipCount: counts.vips,
    venueCapacity: totalVenueCapacity(bookings),
    registrationCapacity,
  };
}

/**
 * Tell every waitlisted Attendee that a place opened. The caller proves the full-to-not-full
 * transition with `didFreePlace` and calls this once for it. Places stay first come, first
 * served: the notice reserves nothing and promotes nobody.
 */
export async function announcePlaceAvailable(
  tx: Pick<Database, "select" | "insert">,
  eventId: number,
  eventNameValue: string
): Promise<number> {
  const waitlisted = await tx
    .select({ attendeeId: eventRegistrations.attendeeId })
    .from(eventRegistrations)
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "waitlisted"))
    )
    .orderBy(asc(eventRegistrations.registeredAt), asc(eventRegistrations.attendeeId));
  if (waitlisted.length === 0) return 0;

  await raiseNotifications(
    tx,
    waitlisted.map(({ attendeeId }) => ({
      recipientId: attendeeId,
      eventRequestId: eventId,
      kind: "registration_place_available" as const,
      payload: { eventName: eventNameValue },
    }))
  );
  return waitlisted.length;
}

/**
 * The event row. Every registration write locks it before it counts. `no key update` leaves room
 * for the key-share locks of foreign-key inserts on the event row.
 */
export async function readEvent(
  database: Pick<Database, "select">,
  eventId: number,
  { lock = false }: { lock?: boolean } = {}
) {
  const query = database
    .select({
      id: eventRequests.id,
      organiserId: eventRequests.organiserId,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
      eventName: eventRequests.eventName,
      status: eventRequests.status,
      registrationEnabled: eventRequests.registrationEnabled,
      registrationCapacity: eventRequests.registrationCapacity,
      registrationOpensAt: eventRequests.registrationOpensAt,
      registrationClosesAt: eventRequests.registrationClosesAt,
    })
    .from(eventRequests)
    .where(eq(eventRequests.id, eventId));
  return (await (lock ? query.for("no key update") : query)).at(0);
}

export type EventRow = NonNullable<Awaited<ReturnType<typeof readEvent>>>;

/**
 * PTR-111: Load the published event the caller manages VIPs for. Only its Organiser and its
 * assigned Coordinator manage VIPs. Refuse a missing event and another user's event in the same
 * way. An event with a released booking still allows VIP removal. Resolve its existing
 * registrations manually.
 */
function requireManagedEvent(event: EventRow | undefined, actor: SessionUser): EventRow {
  if (!event || (event.organiserId !== actor.id && event.assignedCoordinatorId !== actor.id)) {
    throw new AuthorizationError("Forbidden");
  }
  if (!isPublishedForAttendees(event)) throw new ConflictError(VIPS_CLOSED_MESSAGE);
  return event;
}

export function eventName(event: EventRow): string {
  return event.eventName.trim() || "Untitled event";
}

type StakeholderRecipient = { recipientId: string; audience: "organiser" | "coordinator" };

/**
 * List who hears a registration notification: the Organiser always, and the assigned Coordinator
 * when the event has one. Each carries its own audience, so the inbox links each party to its
 * page. `announcePlaceMark`, `announceFreedPlace` in `withdraw.server.ts`, and the
 * registration-boundary sweep all build from this list.
 */
export function stakeholderRecipients(
  event: Pick<EventRow, "organiserId" | "assignedCoordinatorId">
): StakeholderRecipient[] {
  const recipients: StakeholderRecipient[] = [
    { recipientId: event.organiserId, audience: "organiser" },
  ];
  if (event.assignedCoordinatorId) {
    recipients.push({ recipientId: event.assignedCoordinatorId, audience: "coordinator" });
  }
  return recipients;
}

/**
 * PTR-45 AC8 and AC9: Tell the Organiser, and the assigned Coordinator when one exists, that
 * normal registrations stand on a mark of the place limit. Tell each count-and-limit pair once
 * per event. A VIP added and removed repeatedly then sends no repeat notice (PTR-111).
 */
async function announcePlaceMark(
  tx: Pick<Database, "select" | "insert">,
  event: EventRow,
  registered: number,
  limit: number
) {
  const told = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.eventRequestId, event.id),
        eq(notifications.kind, "registration_threshold_reached"),
        sql`${notifications.payload} @> ${JSON.stringify({ registered, limit })}::jsonb`
      )
    )
    .limit(1);
  if (told.length > 0) return;

  await raiseNotifications(
    tx,
    stakeholderRecipients(event).map(({ recipientId, audience }) => ({
      recipientId,
      eventRequestId: event.id,
      kind: "registration_threshold_reached",
      payload: { eventName: eventName(event), registered, limit, audience },
    }))
  );
}

/** The Attendee's registration status for the event, or null when they hold no row. */
async function registrationStatus(
  database: Pick<Database, "select">,
  eventId: number,
  attendeeId: string
): Promise<"registered" | "withdrawn" | "waitlisted" | null> {
  const rows = await database
    .select({ status: eventRegistrations.status })
    .from(eventRegistrations)
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.attendeeId, attendeeId))
    )
    .limit(1);
  return rows.at(0)?.status ?? null;
}

/** Check whether the Attendee holds a `registered` registration of either kind. */
async function isRegistered(
  database: Pick<Database, "select">,
  eventId: number,
  attendeeId: string
): Promise<boolean> {
  const rows = await database
    .select({ attendeeId: eventRegistrations.attendeeId })
    .from(eventRegistrations)
    .where(
      and(
        eq(eventRegistrations.eventId, eventId),
        eq(eventRegistrations.attendeeId, attendeeId),
        eq(eventRegistrations.status, "registered")
      )
    );
  return rows.length > 0;
}

/** One approved booking with its venue, as the registration readers list it. */
export interface ApprovedVenueBooking {
  venueId: number;
  venueName: string;
  venueLocation: string;
  venueCapacity: number;
  startsAt: string;
  endsAt: string;
}

/**
 * List every approved booking of the event that no live venue block suspends, in booking creation order.
 * The first entry keeps the single-venue fields that stored notifications carry. Callers sum
 * distinct venues with `totalVenueCapacity`.
 */
export async function approvedBookings(
  database: Pick<Database, "select">,
  eventId: number
): Promise<ApprovedVenueBooking[]> {
  return database
    .select({
      venueId: venues.id,
      venueName: venues.name,
      venueLocation: venues.location,
      venueCapacity: venues.maxCapacity,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(
      and(
        eq(venueRequests.eventId, eventId),
        eq(venueRequests.status, "approved"),
        notSuspendedByLiveBlock(database)
      )
    )
    .orderBy(venueRequests.createdAt, venueRequests.id);
}

export async function countRegistrations(database: Pick<Database, "select">, eventId: number) {
  const [counts] = await database
    .select(registrationCounts)
    .from(eventRegistrations)
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "registered"))
    );
  return counts;
}
