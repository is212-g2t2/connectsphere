import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { equipmentReservations, equipmentTypes, equipmentUnavailability } from "#/db/schema";
import { NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  computeAvailableEquipmentQuantity,
  summariseAvailability,
} from "#/features/equipment-requests/availability";
import { loadWorkableLines } from "#/features/equipment-requests/equipment.server";
import { parseAvailabilityCheckInput } from "#/features/equipment-requests/schema";
import {
  bookingPeriod,
  chooseEquipmentBooking,
  selectEquipmentBookings,
} from "#/features/equipment-requests/bookings.server";

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
  const overlapConditions = [
    eq(equipmentReservations.equipmentTypeId, args.equipmentTypeId),
    lt(equipmentReservations.startsAt, args.window.endsAt),
    gt(equipmentReservations.endsAt, args.window.startsAt),
  ];
  if (args.excludeReservationId) {
    overlapConditions.push(ne(equipmentReservations.id, args.excludeReservationId));
  }

  // A transaction handle serves one query at a time. Read in sequence so the reserve
  // path, which passes its tx, never issues concurrent queries on one connection.
  const typeRows =
    args.quantityHeld === undefined
      ? await database
          .select({ quantityHeld: equipmentTypes.quantityHeld })
          .from(equipmentTypes)
          .where(eq(equipmentTypes.id, args.equipmentTypeId))
          .limit(1)
      : [];
  const unavailableRows = await database
    .select({
      unavailable: sql<number>`coalesce(sum(${equipmentUnavailability.quantityUnavailable}), 0)::int`,
    })
    .from(equipmentUnavailability)
    .where(eq(equipmentUnavailability.equipmentTypeId, args.equipmentTypeId));
  const overlapping = await database
    .select({
      startsAt: equipmentReservations.startsAt,
      endsAt: equipmentReservations.endsAt,
      quantity: equipmentReservations.quantity,
    })
    .from(equipmentReservations)
    .where(and(...overlapConditions));

  let quantityHeld = args.quantityHeld;
  if (quantityHeld === undefined) {
    const equipmentType = typeRows.at(0);
    if (!equipmentType) throw new NotFoundError("Not Found");
    quantityHeld = equipmentType.quantityHeld;
  }

  const [{ unavailable }] = unavailableRows;

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

/** Check the chosen booking's buffered window, including the event's own reservations. */
export async function handleCheckEquipmentAvailability(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseAvailabilityCheckInput(data);

  await loadWorkableLines(database, input.eventId, actor);

  const booking = chooseEquipmentBooking(
    await selectEquipmentBookings(database, [input.eventId]),
    input.venueRequestId,
    "The event has no active approved venue booking yet"
  );
  const equipmentType = (
    await database
      .select({ name: equipmentTypes.name })
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, input.equipmentTypeId))
      .limit(1)
  ).at(0);
  if (!equipmentType) throw new NotFoundError("Not Found");
  const availability = await loadTypeAvailability(database, {
    equipmentTypeId: input.equipmentTypeId,
    window: booking,
  });

  return {
    ...summariseAvailability({
      held: availability.quantityHeld,
      reserved: availability.peakReserved,
      unavailable: availability.totalUnavailable,
      requested: input.requestedQuantity,
    }),
    equipmentTypeName: equipmentType.name,
    period: bookingPeriod(booking),
  };
}

/** PTR-40: List equipment types for the availability picker. */
export async function handleListEquipmentTypes(database: Database) {
  return database
    .select({ id: equipmentTypes.id, name: equipmentTypes.name })
    .from(equipmentTypes)
    .orderBy(asc(equipmentTypes.name));
}
