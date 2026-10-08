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
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here. Reached via a
 * dynamic `import()` inside `.handler()` in `server-fns.ts`. The middleware pipeline has already
 * verified the session and `event:register` before this runs.
 */

type Database = typeof Db;

/**
 * PTR-47: an Attendee withdraws a `registered` registration. The event row lock (AC2: first-come-
 * first-served on register, same row) serialises any concurrent registration and this withdrawal,
 * so the capacity count before the flip is consistent.
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
): Promise<boolean> {
  const input = parseEventRequestId(data);

  return database.transaction(async tx => {
    // Lock the event row so concurrent registrations queue on it while we adjust the count.
    const event = await readEvent(tx, input.id, { lock: true });

    // A missing event and a draft one answer exactly as an event the caller holds no registration
    // for, so a probe cannot tell from the refusal whether the id exists.
    if (!event || event.status === "draft") throw new ConflictError(NOT_REGISTERED_MESSAGE);

    // AC4 counts come from before the flip: a withdrawn VIP row drops `vips` and can raise the
    // limit while `registered` stands still, so counting after would blame the VIP for a freed
    // place the event never lost.
    const booking = await approvedBooking(tx, event.id);
    const capacity = event.registrationCapacity;
    const countsBefore =
      booking && capacity !== null ? await countRegistrations(tx, event.id) : null;

    // Flip the registration from `registered` to `withdrawn`. Nothing happens when the row does
    // not exist or is already `withdrawn` — the returning array is empty and the refusal fires.
    // The caller's own row resolves before the status gates, so a caller with no registration
    // learns nothing about the event's status from the refusal.
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

    // Completed events take no activity writes, the project-wide rule `assertEventAcceptsActivity`
    // owns; cancelled events neither. Both run after the flip, so the thrown error rolls it back.
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

    // AC4: was the event at its registration capacity before the withdrawal? The after-values
    // follow from the flipped row: a VIP leaves `registered` standing and drops `vips` by one.
    if (booking && capacity !== null && countsBefore !== null) {
      const withdrawingVip = updated[0].vip;
      const registeredBefore = countsBefore.registered;
      const vipsBefore = countsBefore.vips;
      const registeredAfter = withdrawingVip ? registeredBefore : registeredBefore - 1;
      const vipsAfter = withdrawingVip ? vipsBefore - 1 : vipsBefore;
      const limitBefore = placeLimit(capacity, booking.venueCapacity, vipsBefore);
      const limitAfter = placeLimit(capacity, booking.venueCapacity, vipsAfter);
      // The withdrawal freed a place exactly when the normal registrations stood at the limit
      // before and stand below it after.
      if (registeredBefore >= limitBefore && registeredAfter < limitAfter) {
        await announceFreedPlace(tx, event, limitAfter);
        placeFreedAtCapacity = true;
      }
    }

    return placeFreedAtCapacity;
  });
}

/**
 * PTR-47 AC4: tells the Organiser, and the assigned Coordinator when there is one, that a place
 * was freed from an event that had been at its registration capacity. The recipients come from
 * `stakeholderRecipients`, the same builder `announcePlaceMark` uses.
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
