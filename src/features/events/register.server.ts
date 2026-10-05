import { and, count, eq, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRegistrations, eventRequests, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { isPublishedForAttendees } from "#/features/events/access";
import {
  ALREADY_REGISTERED_MESSAGE,
  crossesPlaceThreshold,
  placeLimit,
  registrationRefusal,
} from "#/features/events/registration";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, so this is
 * reached through a dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware
 * pipeline has already verified the session and `event:register`.
 */

type Database = typeof Db;

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
    const event = (
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
        .where(eq(eventRequests.id, input.id))
        .for("no key update")
    ).at(0);

    // AC2: only a published event takes registrations. A missing event and an unpublished one
    // are refused the same way, so the refusal does not say whether the id exists.
    if (!event || !isPublishedForAttendees(event)) throw new AuthorizationError("Forbidden");

    const own = (
      await tx
        .select({ status: eventRegistrations.status })
        .from(eventRegistrations)
        .where(
          and(eq(eventRegistrations.eventId, event.id), eq(eventRegistrations.attendeeId, actor.id))
        )
    ).at(0);

    // The venue the event page shows: the earliest approved booking, as `records.server` picks it.
    const booking = (
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
        .where(and(eq(venueRequests.eventId, event.id), eq(venueRequests.status, "approved")))
        .orderBy(venueRequests.createdAt, venueRequests.id)
        .limit(1)
    ).at(0);

    const [{ registered }] = await tx
      .select({ registered: count() })
      .from(eventRegistrations)
      .where(
        and(eq(eventRegistrations.eventId, event.id), eq(eventRegistrations.status, "registered"))
      );

    const refusal = registrationRefusal({
      ...event,
      now: toLocalMinuteValue(venueLocalTimestamp(now)),
      alreadyRegistered: own?.status === "registered",
      registeredCount: registered,
      venueCapacity: booking?.venueCapacity ?? null,
    });
    if (refusal) throw new ConflictError(refusal);

    // The refusal rules guarantee both; the throw only narrows the types.
    const capacity = event.registrationCapacity;
    if (!booking || capacity === null) {
      throw new Error("Registration passed without an approved booking or a capacity");
    }

    // One row for each Attendee and event: a withdrawn registration returns to `registered`
    // (PTR-47 AC5). A `registered` row is left as it is, so no row comes back (AC6).
    const registration = (
      await tx
        .insert(eventRegistrations)
        .values({ eventId: event.id, attendeeId: actor.id })
        .onConflictDoUpdate({
          target: [eventRegistrations.eventId, eventRegistrations.attendeeId],
          set: { status: "registered", registeredAt: sql`now()` },
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
    const limit = placeLimit(capacity, booking.venueCapacity);
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
