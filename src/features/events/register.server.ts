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
import type { NewNotification } from "#/features/notifications/raise.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event:register` or `vip_registration:manage`.
 */

type Database = typeof Db;

/**
 * The event's `registered` registrations, the normal ones and the VIPs (PTR-111) apart, as select
 * columns. `records.server` counts the attendee's places with the same two.
 */
export const registrationCounts = {
  registered: sql<number>`count(*) filter (where not ${eventRegistrations.vip})`.mapWith(Number),
  vips: sql<number>`count(*) filter (where ${eventRegistrations.vip})`.mapWith(Number),
};

/**
 * PTR-45: an Attendee registers for a published event. The event row is the lock that every
 * registration for the event takes before it counts. Two Attendees who race for the last place
 * therefore queue on it, and the second one counts the first (AC3).
 *
 * The registration and its notifications commit together; the worker sends the emails.
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

    // AC2: only a published event takes registrations. A missing event and an unpublished one
    // are refused the same way, so the refusal does not say whether the id exists.
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

    // The refusal rules guarantee both; the throw only narrows the types.
    const capacity = event.registrationCapacity;
    if (!booking || capacity === null) {
      throw new Error("Registration passed without an approved booking or a capacity");
    }

    // One row for each Attendee and event: a withdrawn registration returns to `registered`
    // (PTR-47 AC5), as the Attendee's own even where it was a removed VIP registration. A
    // `registered` row is left as it is, so no row comes back (AC6).
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
    // AC8 and AC9: only the registration that brings the registered count to 90% of the place
    // limit, or to the limit itself, so each threshold is announced as the count crosses it.
    const limit = placeLimit(capacity, booking.venueCapacity, vips);
    if (placeMark(registered + 1, limit)) await announcePlaceMark(tx, event, registered + 1, limit);

    return { status: registration.status, registeredAt: registration.registeredAt.toISOString() };
  });
}

/**
 * PTR-111: the Attendee accounts that the Organiser or the assigned Coordinator can add as a VIP,
 * found by part of the name or the email, case-insensitively. An Attendee who already holds a
 * registration for the event is left out. The account with exactly the typed email comes first,
 * so accounts named after a guest cannot push the guest's own account out of the results.
 */
export async function handleSearchVipAttendees(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<VipAttendee[]> {
  const input = parseVipSearchInput(data);
  const event = requireManagedEvent(await readEvent(database, input.id), actor);

  // `\` is the ILIKE escape character, so a typed `%` or `_` matches only itself.
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
 * PTR-111: the Organiser or the assigned Coordinator adds a VIP registration for an Attendee
 * account. The VIP takes the event row lock that an Attendee's own registration takes, so a VIP
 * and an Attendee who race for the venue's last place queue on it (AC3). The change log keeps the
 * acting user and the time (AC5).
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

    // AC2 and AC3: the registration capacity and period do not apply. The venue on the approved
    // booking is the only ceiling, and with no approved booking there is no ceiling to hold to.
    const booking = await approvedBooking(tx, event.id);
    if (!booking) throw new ConflictError(REGISTRATION_NOT_OPEN_MESSAGE);
    const { registered, vips } = await countRegistrations(tx, event.id);
    if (registered + vips >= booking.venueCapacity) {
      throw new ConflictError(venueCapacityReachedMessage(booking.venueCapacity));
    }

    // The Attendee's one row for the event: a withdrawn registration of either kind becomes this
    // VIP registration.
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

    // The VIP can leave normal registration one place fewer. Where that moves the normal
    // registrations onto the 90% or the full mark of the new limit, the Organiser and the
    // Coordinator are told, as a normal registration that reaches the mark tells them (PTR-45 AC8,
    // AC9). The mark is compared, not only its presence: 9 of 10 is 90%, but 9 of 9 is full.
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
 * PTR-111 AC6: the Organiser or the assigned Coordinator removes a VIP registration. It becomes
 * `withdrawn`, so it no longer holds a venue place, and the change log keeps who removed it and
 * when.
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
 * The event row. Every registration write locks it before it counts; `no key update` does not
 * block the key-share locks that foreign-key inserts take on the event row.
 */
async function readEvent(
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

type EventRow = NonNullable<Awaited<ReturnType<typeof readEvent>>>;

/**
 * PTR-111: the published event that the caller manages VIPs for. Only its Organiser and its
 * assigned Coordinator do, and a missing event and someone else's are refused the same way. A
 * published event whose booking was released still lets them remove a VIP, so its existing
 * registrations can be resolved manually.
 */
function requireManagedEvent(event: EventRow | undefined, actor: SessionUser): EventRow {
  if (!event || (event.organiserId !== actor.id && event.assignedCoordinatorId !== actor.id)) {
    throw new AuthorizationError("Forbidden");
  }
  if (!isPublishedForAttendees(event)) throw new ConflictError(VIPS_CLOSED_MESSAGE);
  return event;
}

function eventName(event: EventRow): string {
  return event.eventName.trim() || "Untitled event";
}

/**
 * PTR-45 AC8 and AC9: tells the Organiser, and the assigned Coordinator when there is one, that the
 * normal registrations stand on a mark of the place limit. Each pair of count and limit is told
 * once for each event, so a VIP added and removed again and again cannot send it again and again
 * (PTR-111).
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

  const threshold = { eventName: eventName(event), registered, limit };
  const notices: NewNotification[] = [
    {
      recipientId: event.organiserId,
      eventRequestId: event.id,
      kind: "registration_threshold_reached",
      payload: { ...threshold, audience: "organiser" },
    },
  ];
  if (event.assignedCoordinatorId) {
    notices.push({
      recipientId: event.assignedCoordinatorId,
      eventRequestId: event.id,
      kind: "registration_threshold_reached",
      payload: { ...threshold, audience: "coordinator" },
    });
  }
  await raiseNotifications(tx, notices);
}

/** Whether the Attendee holds a `registered` registration for the event, of either kind. */
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

/** The venue the event page shows: the earliest approved booking, as `records.server` picks it. */
async function approvedBooking(database: Pick<Database, "select">, eventId: number) {
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

async function countRegistrations(database: Pick<Database, "select">, eventId: number) {
  const [counts] = await database
    .select(registrationCounts)
    .from(eventRegistrations)
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "registered"))
    );
  return counts;
}
