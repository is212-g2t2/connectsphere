import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  eventRequests,
  venueOccupancy,
  venueRequests,
} from "#/db/schema";
import { suspendedPieceWhere } from "#/features/venues/blocked-arrangements.server";

/**
 * Keep this module server-only: `#/db/schema` is a value import. PTR-146's one arrangement
 * fingerprint. The review list, the decision, the sweep (PTR-148) and the confirmation gate
 * (PTR-147) all read it, so a material arrangement change invalidates a review in every reader at
 * once.
 *
 * Venue catalogue attributes stay out of the input. A catalogue edit never reverts an event. The
 * review page shows the venue's current attributes beside the fingerprint.
 */

type Database = typeof Db;

/** One approved booking, with its own session requirements and its live suspended state. */
interface FingerprintBooking {
  id: string;
  venueId: number;
  startsAt: string;
  endsAt: string;
  suspended: boolean;
  expectedAttendance: number | null;
  layout: string | null;
  accessibilityRequirements: string | null;
  requiredFacilities: string | null;
}

/** One venue request that is neither approved nor withdrawn: it still bears on the gate. */
interface FingerprintVenueRequest {
  id: string;
  status: string;
}

/** One equipment line, with its reservation when one exists. */
interface FingerprintEquipmentLine {
  item: string;
  type: number | null;
  quantity: number;
  state: string;
  reservedType: number | null;
  reservedQuantity: number | null;
}

/** The canonical input a fingerprint hashes. Every field here is material to the safety review. */
export interface ArrangementFingerprintInput {
  event: {
    /** The significant fields (PTR-23) and the layout preference. */
    proposedDates: unknown;
    expectedAttendance: number | null;
    venueRequirements: string;
    equipmentRequirements: unknown;
    roomLayoutPreference: string;
  };
  bookings: FingerprintBooking[];
  venueRequests: FingerprintVenueRequest[];
  equipment: FingerprintEquipmentLine[];
  /** The equipment completion marker (PTR-43) as a boolean. */
  equipmentCompleted: boolean;
}

/**
 * Hash one canonical input. Sort every collection, so row order never changes the result. Use
 * `JSON.stringify` for the scalar shape: the input is already canonical.
 */
export function arrangementFingerprintOf(input: ArrangementFingerprintInput): string {
  const canonical = {
    event: {
      proposedDates: input.event.proposedDates,
      expectedAttendance: input.event.expectedAttendance,
      venueRequirements: input.event.venueRequirements,
      equipmentRequirements: input.event.equipmentRequirements,
      roomLayoutPreference: input.event.roomLayoutPreference,
    },
    bookings: [...input.bookings].toSorted((a, b) => compareIds(a.id, b.id)),
    venueRequests: [...input.venueRequests].toSorted((a, b) => compareIds(a.id, b.id)),
    // A line has no id in the input, so sort the serialized lines. Two equal lines stay as two
    // entries: removing one is a material change, even when the lines read the same.
    equipment: input.equipment.map(line => JSON.stringify(line)).toSorted(),
    equipmentCompleted: input.equipmentCompleted,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Compare two row ids by code point. `localeCompare` would make the hash depend on the ICU
 * locale, so the same arrangements could fingerprint differently after a runtime upgrade.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Load the canonical input for each event, in one batched read per table. An event that is not
 * there is absent from the map.
 */
export async function loadArrangementFingerprintInputs(
  database: Pick<Database, "select">,
  eventIds: readonly number[]
): Promise<Map<number, ArrangementFingerprintInput>> {
  const inputs = new Map<number, ArrangementFingerprintInput>();
  if (eventIds.length === 0) return inputs;
  const ids = [...eventIds];

  const [events, bookings, outstanding, equipment, suspended] = await Promise.all([
    database
      .select({
        id: eventRequests.id,
        proposedDates: eventRequests.proposedDates,
        expectedAttendance: eventRequests.expectedAttendance,
        venueRequirements: eventRequests.venueRequirements,
        equipmentRequirements: eventRequests.equipmentRequirements,
        roomLayoutPreference: eventRequests.roomLayoutPreference,
        equipmentArrangementsCompletedAt: eventRequests.equipmentArrangementsCompletedAt,
      })
      .from(eventRequests)
      .where(inArray(eventRequests.id, ids)),
    database
      .select({
        eventId: venueRequests.eventId,
        id: venueRequests.id,
        venueId: venueRequests.venueId,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
        expectedAttendance: venueRequests.expectedAttendance,
        layout: venueRequests.layout,
        accessibilityRequirements: venueRequests.accessibilityRequirements,
        requiredFacilities: venueRequests.requiredFacilities,
      })
      .from(venueRequests)
      .where(and(inArray(venueRequests.eventId, ids), eq(venueRequests.status, "approved"))),
    database
      .select({
        eventId: venueRequests.eventId,
        id: venueRequests.id,
        status: venueRequests.status,
      })
      .from(venueRequests)
      .where(
        and(
          inArray(venueRequests.eventId, ids),
          inArray(venueRequests.status, ["pending", "rejected", "released"])
        )
      ),
    database
      .select({
        eventId: equipmentRequests.eventId,
        item: equipmentRequests.item,
        type: equipmentRequests.equipmentTypeId,
        quantity: equipmentRequests.quantity,
        state: equipmentRequests.arrangementStatus,
        reservedType: equipmentReservations.equipmentTypeId,
        reservedQuantity: equipmentReservations.quantity,
      })
      .from(equipmentRequests)
      .leftJoin(
        equipmentReservations,
        eq(equipmentReservations.equipmentRequestId, equipmentRequests.id)
      )
      .where(inArray(equipmentRequests.eventId, ids)),
    database
      .select({ eventId: venueOccupancy.eventId, venueRequestId: venueOccupancy.venueRequestId })
      .from(venueOccupancy)
      .where(and(inArray(venueOccupancy.eventId, ids), suspendedPieceWhere())),
  ]);

  const suspendedBookings = new Set(
    suspended.flatMap(row => (row.venueRequestId === null ? [] : [row.venueRequestId]))
  );

  for (const event of events) {
    inputs.set(event.id, {
      event: {
        proposedDates: event.proposedDates,
        expectedAttendance: event.expectedAttendance,
        venueRequirements: event.venueRequirements,
        equipmentRequirements: event.equipmentRequirements,
        roomLayoutPreference: event.roomLayoutPreference,
      },
      bookings: bookings
        .filter(booking => booking.eventId === event.id)
        .map(booking => ({
          id: booking.id,
          venueId: booking.venueId,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          suspended: suspendedBookings.has(booking.id),
          expectedAttendance: booking.expectedAttendance,
          layout: booking.layout,
          accessibilityRequirements: booking.accessibilityRequirements,
          requiredFacilities: booking.requiredFacilities,
        })),
      venueRequests: outstanding
        .filter(request => request.eventId === event.id)
        .map(request => ({ id: request.id, status: request.status })),
      equipment: equipment
        .filter(line => line.eventId === event.id)
        .map(line => ({
          item: line.item,
          type: line.type,
          quantity: line.quantity,
          state: line.state,
          reservedType: line.reservedType,
          reservedQuantity: line.reservedQuantity,
        })),
      equipmentCompleted: event.equipmentArrangementsCompletedAt !== null,
    });
  }

  return inputs;
}

/** The current fingerprint of one event, or null when the event is not there. */
export async function arrangementFingerprint(
  database: Pick<Database, "select">,
  eventId: number
): Promise<string | null> {
  const input = (await loadArrangementFingerprintInputs(database, [eventId])).get(eventId);
  return input === undefined ? null : arrangementFingerprintOf(input);
}
