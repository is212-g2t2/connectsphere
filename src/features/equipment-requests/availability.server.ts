import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentReservations,
  equipmentTypes,
  equipmentUnavailability,
  venueRequests,
} from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  computeAvailableEquipmentQuantity,
  summariseAvailability,
} from "#/features/equipment-requests/availability";
import { loadWorkableLines } from "#/features/equipment-requests/equipment.server";
import { parseAvailabilityCheckInput } from "#/features/equipment-requests/schema";
import { toLocalMinuteValue } from "#/features/venues/availability";

/** Server-only because it imports `#/db/schema`. See `equipment.server.ts`. */

type Database = typeof Db;

/**
 * Return units available during a window. Read `quantityHeld` unless the caller passes a locked
 * row. Read unavailable units and reservations that overlap the window. Periods use half-open
 * bounds, so touching periods do not overlap. Then find the peak.
 */
export async function loadTypeAvailability(
  database: Pick<Database, "select">,
  args: {
    equipmentTypeId: number;
    window: { startsAt: string; endsAt: string };
    excludeReservationId?: string;
    /** The reserve path passes `quantityHeld` from its locked row. */
    quantityHeld?: number;
  }
): Promise<{
  quantityHeld: number;
  totalUnavailable: number;
  peakReserved: number;
  availableQuantity: number;
}> {
  let quantityHeld = args.quantityHeld;
  if (quantityHeld === undefined) {
    const rows = await database
      .select()
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, args.equipmentTypeId))
      .limit(1);
    const equipmentType = rows.at(0);
    if (!equipmentType) throw new NotFoundError("Not Found");
    quantityHeld = equipmentType.quantityHeld;
  }

  const [{ unavailable }] = await database
    .select({
      unavailable: sql<number>`coalesce(sum(${equipmentUnavailability.quantityUnavailable}), 0)::int`,
    })
    .from(equipmentUnavailability)
    .where(eq(equipmentUnavailability.equipmentTypeId, args.equipmentTypeId));

  const overlapConditions = [
    eq(equipmentReservations.equipmentTypeId, args.equipmentTypeId),
    lt(equipmentReservations.startsAt, args.window.endsAt),
    gt(equipmentReservations.endsAt, args.window.startsAt),
  ];
  if (args.excludeReservationId) {
    overlapConditions.push(ne(equipmentReservations.id, args.excludeReservationId));
  }

  const overlapping = await database
    .select({
      startsAt: equipmentReservations.startsAt,
      endsAt: equipmentReservations.endsAt,
      quantity: equipmentReservations.quantity,
    })
    .from(equipmentReservations)
    .where(and(...overlapConditions));

  const { availableQuantity, peakReserved } = computeAvailableEquipmentQuantity(
    quantityHeld,
    unavailable,
    args.window,
    overlapping
  );

  return {
    quantityHeld,
    totalUnavailable: unavailable,
    peakReserved,
    availableQuantity,
  };
}

/**
 * PTR-40 AC1-AC4: Return units available during an event's approved venue booking. Use the queue
 * rule from `handleUpdateArrangement`. The actor must be able to work on at least one event line.
 *
 * Include the event's own reservations. Check each approved booking window. Report the window with
 * the least availability. If there is a tie, report the earliest window.
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

  const perBooking = await Promise.all(
    bookings.map(async booking => {
      const availability = await loadTypeAvailability(database, {
        equipmentTypeId: equipmentType.id,
        window: { startsAt: booking.startsAt, endsAt: booking.endsAt },
      });
      return {
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        quantityHeld: availability.quantityHeld,
        totalUnavailable: availability.totalUnavailable,
        peakReserved: availability.peakReserved,
        availableQuantity: availability.availableQuantity,
      };
    })
  );
  const tightest = perBooking.reduce((a, b) => (b.availableQuantity < a.availableQuantity ? b : a));

  return {
    ...summariseAvailability({
      held: tightest.quantityHeld,
      reserved: tightest.peakReserved,
      unavailable: tightest.totalUnavailable,
      requested: input.requestedQuantity,
    }),
    equipmentTypeName: equipmentType.name,
    period: {
      startsAt: toLocalMinuteValue(tightest.startsAt),
      endsAt: toLocalMinuteValue(tightest.endsAt),
    },
  };
}

/** PTR-40: List equipment types for the availability picker. */
export async function handleListEquipmentTypes(database: Database) {
  return database
    .select({ id: equipmentTypes.id, name: equipmentTypes.name })
    .from(equipmentTypes)
    .orderBy(asc(equipmentTypes.name));
}
