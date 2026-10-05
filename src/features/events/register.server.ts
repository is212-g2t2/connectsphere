import { and, eq, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRegistrations, eventRequests, user, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { isPublishedForAttendees } from "#/features/events/access";
import type { VipRegistration } from "#/features/events/access";
import {
  ALREADY_REGISTERED_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_ALREADY_REMOVED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  crossesPlaceThreshold,
  placeLimit,
  registrationRefusal,
  vipRegistrationRefusal,
} from "#/features/events/registration";
import { parseVipRegistrationInput, parseVipRemovalInput } from "#/features/events/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event:register` or `vip_registration:manage`.
 */

type Database = typeof Db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-45: an Attendee registers for a published event. The event row is the lock that every
 * registration for the event takes before it counts. Two Attendees who race for the last place
 * therefore queue on it, and the second one counts the first (AC3). `no key update` does not block
 * the key-share locks that foreign-key inserts take on the event row.
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
    const event = await lockEvent(tx, input.id);

    // AC2: only a published event takes registrations. A missing event and an unpublished one
    // are refused the same way, so the refusal does not say whether the id exists.
    if (!event || !isPublishedForAttendees(event)) throw new AuthorizationError("Forbidden");

    const own = await registrationStatus(tx, event.id, actor.id);
    const booking = await approvedBooking(tx, event.id);
    const { registered, vips } = await countRegistrations(tx, event.id);

    const refusal = registrationRefusal({
      ...event,
      now: toLocalMinuteValue(venueLocalTimestamp(now)),
      alreadyRegistered: own === "registered",
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
    // (PTR-47 AC5), as the Attendee's own, so a removed VIP registration's record is cleared. A
    // `registered` row is left as it is, so no row comes back (AC6).
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: actor.id })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: {
            status: "registered",
            registeredAt: sql`now()`,
            vip: false,
            addedById: null,
            removedById: null,
            removedAt: null,
          },
          setWhere: eq(eventRegistrations.status, "withdrawn"),
        })
        .returning({
          status: eventRegistrations.status,
          registeredAt: eventRegistrations.registeredAt,
        })
    ).at(0);
    if (!registration) throw new ConflictError(ALREADY_REGISTERED_MESSAGE);

    const eventName = event.eventName.trim() || "Untitled event";
    const notices: NewNotification[] = [
      {
        recipientId: actor.id,
        eventRequestId: event.id,
        kind: "event_registered",
        payload: {
          eventName,
          venueName: booking.venueName,
          venueLocation: booking.venueLocation,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
        },
      },
    ];
    // AC8 and AC9: only the registration that brings the registered count to 90% of the place
    // limit, or to the limit itself, so each threshold is announced as the count crosses it.
    const limit = placeLimit(capacity, booking.venueCapacity, vips);
    if (crossesPlaceThreshold(registered + 1, limit)) {
      const threshold = { eventName, registered: registered + 1, limit };
      notices.push({
        recipientId: event.organiserId,
        eventRequestId: event.id,
        kind: "registration_threshold_reached",
        payload: { ...threshold, audience: "organiser" },
      });
      if (event.assignedCoordinatorId) {
        notices.push({
          recipientId: event.assignedCoordinatorId,
          eventRequestId: event.id,
          kind: "registration_threshold_reached",
          payload: { ...threshold, audience: "coordinator" },
        });
      }
    }
    await raiseNotifications(tx, notices);

    return { status: registration.status, registeredAt: registration.registeredAt.toISOString() };
  });
}

/**
 * PTR-111: the Organiser or the assigned Coordinator adds a VIP registration for an Attendee
 * account, named by its email. The VIP takes the event row lock that an Attendee's own
 * registration takes, so a VIP and an Attendee who race for the venue's last place queue on it
 * (AC3). `registeredAt` and `addedById` are the time and the acting user (AC5).
 */
export async function handleAddVipRegistration(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<VipRegistration> {
  const input = parseVipRegistrationInput(data);

  return database.transaction(async tx => {
    const event = await lockManagedEvent(tx, input.id, actor);

    const attendee = (
      await tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(and(eq(user.email, input.email), eq(user.role, "attendee")))
    ).at(0);
    if (!attendee) throw new NotFoundError(VIP_NOT_ATTENDEE_MESSAGE);

    const own = await registrationStatus(tx, event.id, attendee.id);
    const booking = await approvedBooking(tx, event.id);
    const { registered, vips } = await countRegistrations(tx, event.id);

    // AC2 and AC3: the registration capacity and period do not apply, the venue does.
    const refusal = vipRegistrationRefusal({
      alreadyRegistered: own === "registered",
      registeredCount: registered,
      vipCount: vips,
      venueCapacity: booking?.venueCapacity ?? null,
    });
    if (refusal) throw new ConflictError(refusal);

    // The Attendee's one row for the event: a withdrawn registration of either kind becomes this
    // VIP registration, and the record of any earlier removal is cleared.
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: attendee.id, vip: true, addedById: actor.id })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: {
            status: "registered",
            registeredAt: sql`now()`,
            vip: true,
            addedById: actor.id,
            removedById: null,
            removedAt: null,
          },
          setWhere: eq(eventRegistrations.status, "withdrawn"),
        })
        .returning({ attendeeId: eventRegistrations.attendeeId })
    ).at(0);
    if (!registration) throw new ConflictError(VIP_ALREADY_REGISTERED_MESSAGE);

    return { attendeeId: attendee.id, name: attendee.name, email: attendee.email };
  });
}

/**
 * PTR-111 AC6: the Organiser or the assigned Coordinator removes a VIP registration. It becomes
 * `withdrawn`, so it no longer holds a venue place, and the row keeps who removed it and when.
 */
export async function handleRemoveVipRegistration(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVipRemovalInput(data);

  return database.transaction(async tx => {
    const event = await lockManagedEvent(tx, input.id, actor);

    const removed = (
      await tx
        .update(eventRegistrations)
        .set({ status: "withdrawn", removedById: actor.id, removedAt: sql`now()` })
        .where(
          and(
            eq(eventRegistrations.eventId, event.id),
            eq(eventRegistrations.attendeeId, input.attendeeId),
            eq(eventRegistrations.vip, true),
            eq(eventRegistrations.status, "registered")
          )
        )
        .returning({ removedAt: eventRegistrations.removedAt })
    ).at(0);
    if (!removed?.removedAt) throw new ConflictError(VIP_ALREADY_REMOVED_MESSAGE);

    return { attendeeId: input.attendeeId, removedAt: removed.removedAt.toISOString() };
  });
}

/**
 * The event row that every registration write locks before it counts. `no key update` does not
 * block the key-share locks that foreign-key inserts take on the event row.
 */
async function lockEvent(tx: Transaction, eventId: number) {
  return (
    await tx
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
      .where(eq(eventRequests.id, eventId))
      .for("no key update")
  ).at(0);
}

/**
 * PTR-111: the published event that the caller manages VIPs for, locked. Only its Organiser and
 * its assigned Coordinator do, and a missing event and someone else's are refused the same way.
 * A published event whose booking was released still lets them remove a VIP, so its existing
 * registrations can be resolved manually.
 */
async function lockManagedEvent(tx: Transaction, eventId: number, actor: SessionUser) {
  const event = await lockEvent(tx, eventId);
  if (!event || (event.organiserId !== actor.id && event.assignedCoordinatorId !== actor.id)) {
    throw new AuthorizationError("Forbidden");
  }
  if (!isPublishedForAttendees(event)) throw new ConflictError(REGISTRATION_NOT_OPEN_MESSAGE);
  return event;
}

async function registrationStatus(tx: Transaction, eventId: number, attendeeId: string) {
  const row = (
    await tx
      .select({ status: eventRegistrations.status })
      .from(eventRegistrations)
      .where(
        and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.attendeeId, attendeeId))
      )
  ).at(0);
  return row?.status ?? null;
}

/** The venue the event page shows: the earliest approved booking, as `records.server` picks it. */
async function approvedBooking(tx: Transaction, eventId: number) {
  return (
    await tx
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

/** The event's `registered` registrations: the normal ones and the VIPs (PTR-111), apart. */
async function countRegistrations(tx: Transaction, eventId: number) {
  const [counts] = await tx
    .select({
      registered: sql<number>`count(*) filter (where not ${eventRegistrations.vip})`.mapWith(
        Number
      ),
      vips: sql<number>`count(*) filter (where ${eventRegistrations.vip})`.mapWith(Number),
    })
    .from(eventRegistrations)
    .where(
      and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "registered"))
    );
  return counts;
}
