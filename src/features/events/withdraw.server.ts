import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRegistrations, vipRegistrationChanges } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { assertEventAcceptsActivity } from "#/features/events/completion";
import {
  approvedBooking,
  countRegistrations,
  eventName,
  readEvent,
  stakeholderRecipients,
} from "#/features/events/register.server";
import type { EventRow } from "#/features/events/register.server";
import { placeLimit } from "#/features/events/registration";
import { NOT_REGISTERED_MESSAGE } from "#/features/events/withdrawal";
import { raiseNotifications } from "#/features/notifications/raise.server";

/**
 * Keep this module server-only. It imports `#/db/schema` as a value. `server-fns.ts` loads it
 * dynamically inside `.handler()`. Middleware already verified the session and `event:register`.
 */

type Database = typeof Db;

/**
 * PTR-47: An Attendee withdraws a `registered` registration. The event row lock keeps
 * first-come-first-served order between a concurrent registration and this withdrawal (AC2).
 * The capacity count before the change then stays consistent.
 *
 * AC1: Only a `registered` registration can be withdrawn. Refuse a `withdrawn` or missing row.
 * AC2: The withdrawal frees the place, so it no longer counts against capacity.
 * AC4: When the event was at capacity before the withdrawal, notify the Organiser and the
 * assigned Coordinator that a place is free.
 * AC5 (re-register): `handleRegisterForEvent` handles a return to `registered`. It reuses the
 * existing row with `onConflictDoUpdate`.
 */
export async function handleWithdrawFromEvent(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<boolean> {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    // Lock the event row so concurrent registrations queue on it while we adjust the count.
    const event = await readEvent(tx, input.id, { lock: true });

    // Answer a missing event and a draft exactly as an event with no registration for this
    // caller. A probe then cannot tell whether the id exists.
    if (!event || event.status === "draft") throw new ConflictError(NOT_REGISTERED_MESSAGE);

    // Take AC4 counts before the flip. A withdrawn VIP row drops `vips` and can raise the limit
    // while `registered` stays unchanged. Counting after the flip would blame the VIP for a place
    // the event never lost.
    const booking = await approvedBooking(tx, event.id);
    const capacity = event.registrationCapacity;
    const countsBefore =
      booking && capacity !== null ? await countRegistrations(tx, event.id) : null;

    // Change the registration from `registered` to `withdrawn`. When the row is missing or
    // already `withdrawn`, the update returns nothing and the refusal fires. Resolve the caller's
    // own row before the status gates. A caller with no registration then learns nothing about the
    // event's status.
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
      .returning({ eventId: eventRegistrations.eventId, vip: eventRegistrations.vip });
    if (updated.length === 0) throw new ConflictError(NOT_REGISTERED_MESSAGE);

    // Apply the activity rules after the flip, so a refusal rolls the flip back.
    // `assertEventAcceptsActivity` owns the completed-event rule. Refuse cancelled events too.
    assertEventAcceptsActivity(event.status);
    if (event.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    if (updated[0].vip) {
      await tx.insert(vipRegistrationChanges).values({
        eventId: event.id,
        attendeeId: actor.id,
        change: "removed",
        actorId: actor.id,
      });
    }

    let placeFreedAtCapacity = false;

    // AC4: Check whether the event was at capacity before the withdrawal. Derive the after-values
    // from the flipped row. A withdrawing VIP leaves `registered` unchanged and drops `vips` by one.
    if (booking && capacity !== null && countsBefore !== null) {
      const withdrawingVip = updated[0].vip;
      const registeredBefore = countsBefore.registered;
      const vipsBefore = countsBefore.vips;
      const registeredAfter = withdrawingVip ? registeredBefore : registeredBefore - 1;
      const vipsAfter = withdrawingVip ? vipsBefore - 1 : vipsBefore;
      const limitBefore = placeLimit(capacity, booking.venueCapacity, vipsBefore);
      const limitAfter = placeLimit(capacity, booking.venueCapacity, vipsAfter);
      // The withdrawal freed a place when normal registrations met the limit before and fall
      // below it after.
      if (registeredBefore >= limitBefore && registeredAfter < limitAfter) {
        await announceFreedPlace(tx, event, limitAfter);
        placeFreedAtCapacity = true;
      }
    }

    return placeFreedAtCapacity;
  });
}

/**
 * PTR-47 AC4: Tell the Organiser about a place freed from an event at capacity. Tell the assigned
 * Coordinator too, when one exists. Build recipients with `stakeholderRecipients`, as
 * `announcePlaceMark` does.
 */
async function announceFreedPlace(tx: Pick<Database, "insert">, event: EventRow, limit: number) {
  await raiseNotifications(
    tx,
    stakeholderRecipients(event).map(({ recipientId, audience }) => ({
      recipientId,
      eventRequestId: event.id,
      kind: "registration_place_freed",
      payload: { eventName: eventName(event), limit, audience },
    }))
  );
}
