import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  equipmentTypes,
  equipmentUnavailability,
} from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  computeAvailableEquipmentQuantity,
  summariseAvailability,
} from "#/features/equipment-requests/availability";
import { loadWorkableLines } from "#/features/equipment-requests/equipment.server";
import {
  EQUIPMENT_CATALOGUE_DELETE_REFUSAL,
  EQUIPMENT_CATALOGUE_DUPLICATE_MESSAGE,
  parseAvailabilityCheckInput,
  parseEquipmentTypeId,
  parseEquipmentTypeInput,
  parseEquipmentUnavailabilityInput,
} from "#/features/equipment-requests/schema";
import {
  bookingPeriod,
  chooseEquipmentBooking,
  selectEquipmentBookings,
} from "#/features/equipment-requests/bookings.server";
import { isConstraintViolation } from "#/lib/db-errors";

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

/** PTR-40: List equipment types for the availability picker. PTR-162 adds held and out-of-service totals so the catalogue page reads one list. */
export async function handleListEquipmentTypes(database: Database) {
  const types = await database
    .select({
      id: equipmentTypes.id,
      name: equipmentTypes.name,
      quantityHeld: equipmentTypes.quantityHeld,
    })
    .from(equipmentTypes)
    .orderBy(asc(equipmentTypes.name));
  if (types.length === 0) return [];
  const unavailable = await database
    .select({
      equipmentTypeId: equipmentUnavailability.equipmentTypeId,
      reason: equipmentUnavailability.reason,
      quantityUnavailable: equipmentUnavailability.quantityUnavailable,
    })
    .from(equipmentUnavailability)
    .where(
      inArray(
        equipmentUnavailability.equipmentTypeId,
        types.map(type => type.id)
      )
    );
  const byType = Map.groupBy(unavailable, row => row.equipmentTypeId);
  // oxlint-disable-next-line oxc/no-map-spread
  return types.map(type => {
    const rows = byType.get(type.id) ?? [];
    return {
      ...type,
      totalUnavailable: rows.reduce((sum, row) => sum + row.quantityUnavailable, 0),
      unavailable: rows.toSorted((a, b) => a.reason.localeCompare(b.reason)),
    };
  });
}

/**
 * PTR-162 AC1: add a type or change its quantity held. The id selects the path. A saved change
 * keeps overlapping reservations as stored; the projection derives "Short by N" from the new
 * value. Availability checks and reservations read the new value on their next call.
 */
export async function handleSaveEquipmentType(
  data: unknown,
  _actor: SessionUser,
  database: Database
) {
  const input = parseEquipmentTypeInput(data);
  try {
    if (input.id === undefined) {
      const insertedRows = await database
        .insert(equipmentTypes)
        .values({ name: input.name, quantityHeld: input.quantityHeld })
        .returning();
      const inserted = insertedRows.at(0);
      if (!inserted) throw new NotFoundError("Not Found");
      return inserted;
    }
    const updatedRows = await database
      .update(equipmentTypes)
      .set({ name: input.name, quantityHeld: input.quantityHeld })
      .where(eq(equipmentTypes.id, input.id))
      .returning();
    const updated = updatedRows.at(0);
    if (!updated) throw new NotFoundError("Not Found");
    return updated;
  } catch (error) {
    if (isConstraintViolation(error, "equipment_types_name_unique")) {
      throw new ConflictError(EQUIPMENT_CATALOGUE_DUPLICATE_MESSAGE);
    }
    throw error;
  }
}

/**
 * PTR-162 AC4: delete a type only when no line or reservation references it. The foreign keys
 * use restrict, so this readable refusal runs before the database refusal.
 */
export async function handleDeleteEquipmentType(
  data: unknown,
  _actor: SessionUser,
  database: Database
) {
  const input = parseEquipmentTypeId(data);
  const [line, reservation] = await Promise.all([
    database
      .select({ id: equipmentRequests.id })
      .from(equipmentRequests)
      .where(eq(equipmentRequests.equipmentTypeId, input.id))
      .limit(1),
    database
      .select({ id: equipmentReservations.id })
      .from(equipmentReservations)
      .where(eq(equipmentReservations.equipmentTypeId, input.id))
      .limit(1),
  ]);
  if (line.length > 0 || reservation.length > 0) {
    throw new ConflictError(EQUIPMENT_CATALOGUE_DELETE_REFUSAL);
  }
  const deletedRows = await database
    .delete(equipmentTypes)
    .where(eq(equipmentTypes.id, input.id))
    .returning();
  const deleted = deletedRows.at(0);
  if (!deleted) throw new NotFoundError("Not Found");
  return deleted;
}

/**
 * PTR-162 AC2: record or change the out-of-service quantity for one type and reason. Keep one
 * row per reason so an update does not count the same units twice. Lock the type row first so
 * concurrent saves serialize on the type.
 */
export async function handleSaveEquipmentUnavailability(
  data: unknown,
  _actor: SessionUser,
  database: Database
) {
  const input = parseEquipmentUnavailabilityInput(data);
  return database.transaction(async tx => {
    const type = (
      await tx
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, input.equipmentTypeId))
        .for("update")
        .limit(1)
    ).at(0);
    if (!type) throw new NotFoundError("Not Found");
    const existing = (
      await tx
        .select({ id: equipmentUnavailability.id })
        .from(equipmentUnavailability)
        .where(
          and(
            eq(equipmentUnavailability.equipmentTypeId, input.equipmentTypeId),
            eq(equipmentUnavailability.reason, input.reason)
          )
        )
        .limit(1)
    ).at(0);
    if (existing) {
      const [updated] = await tx
        .update(equipmentUnavailability)
        .set({ quantityUnavailable: input.quantityUnavailable })
        .where(eq(equipmentUnavailability.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await tx
      .insert(equipmentUnavailability)
      .values({
        equipmentTypeId: input.equipmentTypeId,
        reason: input.reason,
        quantityUnavailable: input.quantityUnavailable,
      })
      .returning();
    return inserted;
  });
}
