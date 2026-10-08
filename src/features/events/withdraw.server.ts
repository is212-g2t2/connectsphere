import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRegistrations, eventRequests, venueRequests, venues } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { registrationCounts } from "#/features/events/register.server";
import { placeLimit } from "#/features/events/registration";
import { NOT_REGISTERED_MESSAGE } from "#/features/events/withdrawal";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here. Reached via a
 * dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware pipeline has already
 * verified the session and `event:register` before this runs.
 */

type Database = typeof Db;

/**
 * PTR-47: an Attendee withdraws a `registered` registration. The event row lock (AC2: first-come-
 * first-served on register, same row) serialises any concurrent registration and this withdrawal,
 * so the capacity check that follows the update is consistent.
 *
 * AC1: only a `registered` registration can be withdrawn; a `withdrawn` or absent row is refused.
 * AC2: the withdrawal frees the place, so it no longer counts against capacity.
 * AC4: when the event was at capacity before the withdrawal, the Organiser and the assigned
 * Coordinator are notified that a place has been freed.
 * AC5 (re-register): returning to `registered` is handled by `handleRegisterForEvent`, which
 * uses the existing row via `onConflictDoUpdate`.
 */
export async function handleWithdrawFromEvent(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<void> {
  const input = parseEventRequestId(data);

  await database.transaction(async tx => {
    // Lock the event row so concurrent registrations queue on it while we adjust the count.
    const event = await readEvent(tx, input.id, { lock: true });

    // A missing event and an unpublished one are refused with Forbidden so id existence is not leaked.
    if (!event || event.status === "draft") throw new AuthorizationError("Forbidden");

    // Flip the registration from `registered` to `withdrawn`. Nothing happens when the row does
    // not exist or is already `withdrawn` — the returning array is empty and the refusal fires.
    const updated = await tx
      .update(eventRegistrations)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(eventRegistrations.eventId, event.id),
          eq(eventRegistrations.attendeeId, actor.id),
          eq(eventRegistrations.status, "registered")
        )
      )
      .returning({ eventId: eventRegistrations.eventId });
    if (updated.length === 0) throw new ConflictError(NOT_REGISTERED_MESSAGE);

    // AC4: was the event at its registration capacity before the withdrawal? If so, notify.
    // Count after the update: one fewer registered place means this withdrawal freed one.
    const booking = await approvedBooking(tx, event.id);
    const capacity = event.registrationCapacity;
    if (booking && capacity !== null) {
      const { registered, vips } = await countRegistrations(tx, event.id);
      const limit = placeLimit(capacity, booking.venueCapacity, vips);
      // The withdrawal freed a place exactly when the post-withdrawal count equals limit - 1,
      // meaning the count was at the limit before this registration was withdrawn.
      if (registered === limit - 1) {
        await announceFreedPlace(tx, event, limit);
      }
    }
  });
}

/**
 * PTR-47 AC4: tells the Organiser, and the assigned Coordinator when there is one, that a place
 * was freed from an event that had been at its registration capacity. Matching the same pattern
 * `announcePlaceMark` uses in `register.server.ts` to target the correct stakeholders.
 */
async function announceFreedPlace(
  tx: Pick<Database, "select" | "insert">,
  event: EventRow,
  limit: number
) {
  const eventName = event.eventName.trim() || "Untitled event";
  const notices: NewNotification[] = [
    {
      recipientId: event.organiserId,
      eventRequestId: event.id,
      kind: "registration_place_freed",
      payload: { eventName, limit, audience: "organiser" },
    },
  ];
  if (event.assignedCoordinatorId) {
    notices.push({
      recipientId: event.assignedCoordinatorId,
      eventRequestId: event.id,
      kind: "registration_place_freed",
      payload: { eventName, limit, audience: "coordinator" },
    });
  }
  await raiseNotifications(tx, notices);
}

/** The event row. Lock taken before any capacity-affecting write (same pattern as register). */
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
    })
    .from(eventRequests)
    .where(eq(eventRequests.id, eventId));
  return (await (lock ? query.for("no key update") : query)).at(0);
}

type EventRow = NonNullable<Awaited<ReturnType<typeof readEvent>>>;

async function approvedBooking(database: Pick<Database, "select">, eventId: number) {
  return (
    await database
      .select({
        venueCapacity: venues.maxCapacity,
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
