import { and, asc, eq, exists, gt, lt, ne, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  equipmentTypes,
  equipmentUnavailability,
  venueRequests,
} from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { summariseAvailability } from "#/features/equipment-requests/availability";
import { loadWorkableLines } from "#/features/equipment-requests/equipment.server";
import { parseAvailabilityCheckInput } from "#/features/equipment-requests/schema";
import { toLocalMinuteValue } from "#/features/venues/availability";

/** Server-only: a value import of `#/db/schema`. See `equipment.server.ts` for why. */

type Database = typeof Db;

/**
 * PTR-40 AC1-AC4: units of one type free for the event's approved venue booking. Access is the
 * queue rule `handleUpdateArrangement` uses: the actor must be able to work a line of the event.
 *
 * Reserved counts reservations of the type whose own event's approved booking overlaps the period
 * (half-open, so touching bookings do not), leaving out this event's own reservations.
 */
export async function handleCheckEquipmentAvailability(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseAvailabilityCheckInput(data);

  await loadWorkableLines(database, input.eventId, actor);

  const bookings = await database
    .select({ startsAt: venueRequests.startsAt, endsAt: venueRequests.endsAt })
    .from(venueRequests)
    .where(and(eq(venueRequests.eventId, input.eventId), eq(venueRequests.status, "approved")))
    .orderBy(asc(venueRequests.startsAt));
  if (bookings.length === 0) throw new ConflictError("The event has no approved venue booking yet");

  const rows = await database
    .select()
    .from(equipmentTypes)
    .where(eq(equipmentTypes.id, input.equipmentTypeId))
    .limit(1);
  const equipmentType = rows.at(0);
  if (!equipmentType) throw new NotFoundError("Not Found");

  const [{ unavailable }] = await database
    .select({
      unavailable: sql<number>`coalesce(sum(${equipmentUnavailability.quantityUnavailable}), 0)::int`,
    })
    .from(equipmentUnavailability)
    .where(eq(equipmentUnavailability.equipmentTypeId, equipmentType.id));

  // ponytail: this sum over-counts when overlapping reservations do not overlap each other;
  // switch to a peak sweep if that bites.
  // held and unavailable are constant, so the booking with the most reserved units decides;
  // a tie goes to the earliest.
  const bookingsWithReserved = await Promise.all(
    // oxlint-disable-next-line oxc/no-map-spread -- copy-on-read: `bookings` rows are reused below
    bookings.map(async booking => {
      const [{ reserved }] = await database
        .select({ reserved: sql<number>`coalesce(sum(${equipmentReservations.quantity}), 0)::int` })
        .from(equipmentReservations)
        .innerJoin(
          equipmentRequests,
          eq(equipmentRequests.id, equipmentReservations.equipmentRequestId)
        )
        .where(
          and(
            eq(equipmentReservations.equipmentTypeId, equipmentType.id),
            ne(equipmentRequests.eventId, input.eventId),
            exists(
              database
                .select({ one: sql`1` })
                .from(venueRequests)
                .where(
                  and(
                    eq(venueRequests.eventId, equipmentRequests.eventId),
                    eq(venueRequests.status, "approved"),
                    lt(venueRequests.startsAt, booking.endsAt),
                    gt(venueRequests.endsAt, booking.startsAt)
                  )
                )
            )
          )
        );
      return { ...booking, reserved };
    })
  );
  const tightestBooking = bookingsWithReserved.reduce((a, b) => (b.reserved > a.reserved ? b : a));

  return {
    ...summariseAvailability({
      held: equipmentType.quantityHeld,
      reserved: tightestBooking.reserved,
      unavailable,
      requested: input.requestedQuantity,
    }),
    equipmentTypeName: equipmentType.name,
    period: {
      startsAt: toLocalMinuteValue(tightestBooking.startsAt),
      endsAt: toLocalMinuteValue(tightestBooking.endsAt),
    },
  };
}

/** PTR-40: the catalogue for the availability picker. */
export async function handleListEquipmentTypes(database: Database) {
  return database
    .select({ id: equipmentTypes.id, name: equipmentTypes.name })
    .from(equipmentTypes)
    .orderBy(asc(equipmentTypes.name));
}
