import { and, eq, ilike, notExists, or, sql } from "drizzle-orm";

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
  NOT_A_VIP_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  placeLimit,
  placeMark,
  registrationRefusal,
  venueCapacityReachedMessage,
} from "#/features/events/registration";
import {
  VIP_SEARCH_LIMIT,
  parseVipRegistrationInput,
  parseVipSearchInput,
} from "#/features/events/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";

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

    const booking = await approvedBooking(tx, event.id);
    const { registered, vips } = await countRegistrations(tx, event.id);

    const refusal = registrationRefusal({
      ...event,
      now: toLocalMinuteValue(venueLocalTimestamp(now)),
      alreadyRegistered: await isRegistered(tx, event.id, actor.id),
      registeredCount: registered,
      vipCount: vips,
      venueCapacity: booking?.venueCapacity ?? null,
    });
    if (refusal) throw new ConflictError(refusal);

    // The refusal rules guarantee both values. The throw only narrows the types.
    const capacity = event.registrationCapacity;
    if (!booking || capacity === null) {
      throw new Error("Registration passed without an approved booking or a capacity");
    }

    // Keep one row per Attendee and event. A withdrawn registration returns to `registered`
    // (PTR-47 AC5). It returns as the Attendee's own row, even when it was a removed VIP
    // registration. Leave a `registered` row unchanged, so no row comes back (AC6).
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: actor.id })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: { status: "registered", registeredAt: sql`now()`, vip: false },
          setWhere: eq(eventRegistrations.status, "withdrawn"),
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
        },
      },
    ]);
    // AC8 and AC9: Announce each threshold as the count crosses it. Only the registration that
    // reaches 90% of the place limit, or the limit itself, sends the notice.
    const limit = placeLimit(capacity, booking.venueCapacity, vips);
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
 * Attendee racing for the venue's last place queue on it (AC3). Log the acting user and the time
 * (AC5).
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

    // AC2 and AC3: The registration capacity and period do not apply. The venue on the approved
    // booking sets the only ceiling. With no approved booking, there is no ceiling.
    const booking = await approvedBooking(tx, event.id);
    if (!booking) throw new ConflictError(REGISTRATION_NOT_OPEN_MESSAGE);
    const { registered, vips } = await countRegistrations(tx, event.id);
    if (registered + vips >= booking.venueCapacity) {
      throw new ConflictError(venueCapacityReachedMessage(booking.venueCapacity));
    }

    // Reuse the Attendee's one row for the event. A withdrawn registration of either kind
    // becomes this VIP registration.
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: attendee.id, vip: true })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: { status: "registered", registeredAt: sql`now()`, vip: true },
          setWhere: eq(eventRegistrations.status, "withdrawn"),
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
    const after = placeLimit(capacity, booking.venueCapacity, vips + 1);
    const mark = placeMark(registered, after);
    if (mark && mark !== placeMark(registered, placeLimit(capacity, booking.venueCapacity, vips))) {
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
  });
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

/** Return the venue for the event page: the earliest approved booking, as `records.server` picks it. */
export async function approvedBooking(database: Pick<Database, "select">, eventId: number) {
  return (
    await database
      .select({
        venueName: venues.name,
        venueLocation: venues.location,
        venueCapacity: venues.maxCapacity,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(and(eq(venueRequests.eventId, eventId), eq(venueRequests.status, "approved")))
      .orderBy(venueRequests.createdAt, venueRequests.id)
      .limit(1)
  ).at(0);
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
