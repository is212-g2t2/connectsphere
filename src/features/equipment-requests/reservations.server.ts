import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  equipmentTypes,
  eventRequests,
  venueRequests,
} from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { loadTypeAvailability } from "#/features/equipment-requests/availability.server";
import {
  clearArrangementsCompletion,
  loadWorkableLines,
  raiseCoordinatorNotification,
} from "#/features/equipment-requests/equipment.server";
import {
  RELEASE_NO_RESERVATION_MESSAGE,
  RELEASE_NOT_LOWER_MESSAGE,
  arrangementStateLabel,
  isBlank,
  parseCheckLineAvailabilityInput,
  parseReleaseEquipmentInput,
  parseReserveEquipmentInput,
} from "#/features/equipment-requests/schema";
import { isEquipmentQueueRow } from "#/features/events/access";
import { COMPLETED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/completion";
import { logger } from "#/lib/logger";
import { toLocalMinuteValue } from "#/features/venues/availability";

type Database = typeof Db;

const log = logger.getChild("equipment-requests");

/**
 * The shared staff gate both reserve and release apply: the line, the queue gate and the
 * assignment check. `lock` takes the line `FOR UPDATE`.
 */
async function loadLineForStaff(
  database: Pick<Database, "select">,
  args: { lineId: string; actor: SessionUser; lock?: boolean }
) {
  const lineQuery = database
    .select()
    .from(equipmentRequests)
    .where(eq(equipmentRequests.id, args.lineId))
    .limit(1);
  const line = (await (args.lock ? lineQuery.for("update") : lineQuery)).at(0);

  if (!line) {
    throw new NotFoundError("Equipment request not found");
  }

  // The queue gate runs before any event detail is returned: a refused probe reveals at most
  // that the line id exists, never which event it belongs to or what state it holds.
  const { submitted } = await loadWorkableLines(database, line.eventId, args.actor);

  if (line.assignedStaffId !== null && line.assignedStaffId !== args.actor.id) {
    throw new AuthorizationError("Equipment request is assigned to another staff member");
  }

  if (!isEquipmentQueueRow(line, args.actor.id, submitted)) {
    throw new AuthorizationError("Forbidden");
  }

  return line;
}

/**
 * The preamble the reserve paths share on top of the shared gate: the state gate, the quantity
 * cap, the booking window and the catalogue type. `lock` takes the booking rows `FOR SHARE`
 * too; the reserve handler takes the equipment_types lock after this returns, so every path
 * takes all locks in line-then-bookings-then-type order (AC5). `quantity` carries the reserve
 * amount so its cap keeps its place before the booking read; the check path passes none and
 * takes no locks.
 */
async function loadReservableLine(
  database: Pick<Database, "select">,
  args: { lineId: string; actor: SessionUser; lock?: boolean; quantity?: number }
) {
  const line = await loadLineForStaff(database, {
    lineId: args.lineId,
    actor: args.actor,
    lock: args.lock,
  });

  const eventQuery = database
    .select({ status: eventRequests.status })
    .from(eventRequests)
    .where(eq(eventRequests.id, line.eventId))
    .limit(1);
  const event = (await (args.lock ? eventQuery.for("key share") : eventQuery)).at(0);
  if (event?.status === "completed") {
    throw new ConflictError(COMPLETED_EVENT_ACTIVITY_MESSAGE);
  }

  // PTR-39's hand-set states are not ours to overwrite: a line marked unavailable or not
  // required stays as Technical Support left it until they move it back to requested. The
  // check path applies the same gate so its number never invites a reserve the submit refuses.
  if (line.arrangementStatus !== "requested" && line.arrangementStatus !== "reserved") {
    throw new ConflictError(
      `Cannot reserve equipment for a line marked "${arrangementStateLabel(line.arrangementStatus)}"`
    );
  }

  if (args.quantity !== undefined && args.quantity > line.quantity) {
    throw new ConflictError(
      `Cannot reserve more than the requested quantity of ${line.quantity} units`
    );
  }

  // Lock-independent reads before the type lock: the booking window and the catalogue name
  // need no lock, while the overlap read and the writes below stay under it.
  const bookingQuery = database
    .select({
      id: venueRequests.id,
      startsAt: venueRequests.startsAt,
      endsAt: venueRequests.endsAt,
    })
    .from(venueRequests)
    .where(and(eq(venueRequests.eventId, line.eventId), eq(venueRequests.status, "approved")))
    .limit(2);
  // `FOR SHARE` in the reserve path only: a concurrent venue amend/release cannot commit
  // between this read and the reservation insert below.
  const approvedBookings = await (args.lock ? bookingQuery.for("share") : bookingQuery);

  const approvedBooking = approvedBookings.at(0);

  if (!approvedBooking) {
    throw new ConflictError(
      "Event must have an approved venue booking before equipment can be reserved"
    );
  }

  if (approvedBookings.length > 1) {
    throw new ConflictError(
      "Event has more than one approved venue booking; equipment can only be reserved against a single period"
    );
  }

  let effectiveEquipmentTypeId = line.equipmentTypeId;
  if (effectiveEquipmentTypeId === null) {
    const matchedType = (
      await database
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.name, line.item))
        .limit(1)
    ).at(0);

    if (!matchedType) {
      throw new ConflictError(
        `Cannot reserve equipment: catalogue item "${line.item}" is not registered in equipment catalogue`
      );
    }
    effectiveEquipmentTypeId = matchedType.id;
  }

  return { line, equipmentTypeId: effectiveEquipmentTypeId, booking: approvedBooking };
}

/**
 * Reserves equipment for an event's approved venue booking period (PTR-41).
 *
 * The reservation row stores the equipment type, quantity and the booking window as it stood at
 * reservation time; later booking changes do not move it — availability and overlap read the
 * stored periods only. Re-reserving a line refreshes its snapshot to the current booking.
 *
 * Enforces:
 * - AC1: Line state becomes 'reserved' when reserved quantity >= requested quantity.
 * - AC1 Note: Partial reservation keeps line as 'requested'.
 * - AC2: Refused with 409 Conflict stating shortfall if requested > available.
 * - AC3: Reserved amount is committed and reduces availability for overlapping bookings.
 * - AC5: Serialises concurrent reservations on equipment_types using SELECT FOR UPDATE.
 */
export async function handleReserveEquipment(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseReserveEquipmentInput(data);

  return database.transaction(async tx => {
    const {
      line,
      equipmentTypeId,
      booking: approvedBooking,
    } = await loadReservableLine(tx, {
      lineId: input.equipmentRequestId,
      actor,
      lock: true,
      quantity: input.quantity,
    });

    // Concurrency lock on the equipment_types row (PTR-41 AC5).
    const equipmentType = (
      await tx
        .select()
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, equipmentTypeId))
        .for("update")
    ).at(0);

    if (!equipmentType) {
      throw new NotFoundError("Equipment type not found");
    }

    const existingReservation = (
      await tx
        .select()
        .from(equipmentReservations)
        .where(eq(equipmentReservations.equipmentRequestId, line.id))
        .limit(1)
    ).at(0);

    const { availableQuantity } = await loadTypeAvailability(tx, {
      equipmentTypeId,
      window: { startsAt: approvedBooking.startsAt, endsAt: approvedBooking.endsAt },
      excludeReservationId: existingReservation?.id,
      quantityHeld: equipmentType.quantityHeld,
    });

    if (input.quantity > availableQuantity) {
      const shortfall = input.quantity - availableQuantity;
      const requestedUnits = `${input.quantity} unit${input.quantity === 1 ? "" : "s"}`;
      const availableUnits = `${availableQuantity} unit${availableQuantity === 1 ? "" : "s"}`;
      throw new ConflictError(
        `Requested ${requestedUnits}, but only ${availableUnits} ${
          availableQuantity === 1 ? "is" : "are"
        } available for this period (shortfall of ${shortfall}).`
      );
    }

    let reservationId: string;
    if (existingReservation) {
      reservationId = existingReservation.id;
      await tx
        .update(equipmentReservations)
        .set({
          quantity: input.quantity,
          equipmentTypeId,
          startsAt: approvedBooking.startsAt,
          endsAt: approvedBooking.endsAt,
        })
        .where(eq(equipmentReservations.id, existingReservation.id));
    } else {
      reservationId = `eq-res-${crypto.randomUUID()}`;
      await tx.insert(equipmentReservations).values({
        id: reservationId,
        equipmentRequestId: line.id,
        equipmentTypeId,
        quantity: input.quantity,
        startsAt: approvedBooking.startsAt,
        endsAt: approvedBooking.endsAt,
      });
    }

    const arrangementStatus = input.quantity >= line.quantity ? "reserved" : "requested";
    await tx
      .update(equipmentRequests)
      .set({
        equipmentTypeId,
        arrangementStatus,
        assignedStaffId: line.assignedStaffId ?? actor.id,
      })
      .where(eq(equipmentRequests.id, line.id));

    // A reservation change may move a line out of `reserved`, invalidating a prior completion.
    if (arrangementStatus !== line.arrangementStatus) {
      await clearArrangementsCompletion(tx, line.eventId);
    }

    log.info("Equipment reserved for event", {
      reservationId,
      eventId: line.eventId,
      equipmentRequestId: line.id,
      equipmentTypeId,
      quantity: input.quantity,
      arrangementStatus,
    });

    return {
      reservationId,
      equipmentRequestId: line.id,
      quantity: input.quantity,
      arrangementStatus,
      venueRequestId: approvedBooking.id,
    };
  });
}

/**
 * PTR-41: how much of the line's own type is free for its booking window, leaving out the line's
 * own reservation so re-reserving does not count against itself. The period is the approved
 * booking the number was measured against, so a re-reserve shows which window it re-scopes to.
 */
export async function handleCheckLineAvailability(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseCheckLineAvailabilityInput(data);

  const { line, equipmentTypeId, booking } = await loadReservableLine(database, {
    lineId: input.equipmentRequestId,
    actor,
  });

  const existingReservation = (
    await database
      .select({ id: equipmentReservations.id })
      .from(equipmentReservations)
      .where(eq(equipmentReservations.equipmentRequestId, line.id))
      .limit(1)
  ).at(0);

  const { availableQuantity } = await loadTypeAvailability(database, {
    equipmentTypeId,
    window: { startsAt: booking.startsAt, endsAt: booking.endsAt },
    excludeReservationId: existingReservation?.id,
  });

  return {
    availableQuantity,
    period: {
      startsAt: toLocalMinuteValue(booking.startsAt),
      endsAt: toLocalMinuteValue(booking.endsAt),
    },
  };
}

/**
 * Reduces a line's reservation to a new total, or releases it outright (PTR-42).
 *
 * A release only frees units, so no availability check runs; the freed units show in every
 * overlapping event's availability at once because the sweep reads the reservation rows
 * (criterion 2). Locks are taken in the reserve path's order — the line, then the
 * `equipment_types` row — so a release and a concurrent reserve on the same type serialise rather
 * than interleave. The line's state returns to `requested`, or to `unavailable` with the reason
 * Technical Support gives (criterion 1); its event's status is never written (criterion 4). The
 * assigned Coordinator's notification is raised with the release, the shape the submit notice uses
 * (criterion 3).
 */
export async function handleReleaseEquipment(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseReleaseEquipmentInput(data);
  const unavailableReason =
    input.unavailableReason !== undefined && !isBlank(input.unavailableReason)
      ? input.unavailableReason
      : null;

  const result = await database.transaction(async tx => {
    const line = await loadLineForStaff(tx, {
      lineId: input.equipmentRequestId,
      actor,
      lock: true,
    });

    const reservation = (
      await tx
        .select()
        .from(equipmentReservations)
        .where(eq(equipmentReservations.equipmentRequestId, line.id))
        .limit(1)
    ).at(0);
    if (!reservation) throw new ConflictError(RELEASE_NO_RESERVATION_MESSAGE);
    if (input.quantity >= reservation.quantity) throw new ConflictError(RELEASE_NOT_LOWER_MESSAGE);
    // No state gate is needed: a line holding a reservation can only be `requested` or `reserved`
    // (reserve refuses the hand-set states and the arrangement update freezes a held line), and
    // both are rewritten below. A state that could coexist with a holding would need a gate here.

    // Serialise with reserve on the type (its AC5 lock), taken after the line as reserve does.
    await tx
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, reservation.equipmentTypeId))
      .for("update");

    if (input.quantity === 0) {
      await tx.delete(equipmentReservations).where(eq(equipmentReservations.id, reservation.id));
    } else {
      await tx
        .update(equipmentReservations)
        .set({ quantity: input.quantity })
        .where(eq(equipmentReservations.id, reservation.id));
    }

    const arrangementStatus: "unavailable" | "requested" = unavailableReason
      ? "unavailable"
      : "requested";
    await tx
      .update(equipmentRequests)
      .set({
        arrangementStatus,
        unavailableReason,
        // Keeps the line on the releasing member's list, mirroring reserve.
        assignedStaffId: line.assignedStaffId ?? actor.id,
        lastReleasedByStaffId: actor.id,
        lastReleasedByStaffName: actor.name?.trim() || actor.email,
        lastReleasedAt: new Date(),
        lastReleasedQuantity: reservation.quantity - input.quantity,
      })
      .where(eq(equipmentRequests.id, line.id));

    // PTR-43 AC4: reducing or releasing a reservation invalidates a prior completion stamp.
    await clearArrangementsCompletion(tx, line.eventId);

    // PTR-42 criterion 3: the Coordinator's notice commits with the change; the worker sends the
    // email, so a mail outage cannot lose the record of what was given back.
    const notificationQueued = await raiseCoordinatorNotification(tx, line.eventId, context => ({
      recipientId: context.coordinatorId,
      eventRequestId: line.eventId,
      kind: "equipment_released",
      payload: {
        eventName: context.eventName,
        item: line.item,
        requestedQuantity: line.quantity,
        previousQuantity: reservation.quantity,
        quantity: input.quantity,
        arrangementStatus,
        unavailableReason,
        actorName: actor.name ?? "Technical Support",
      },
    }));

    log.info("Equipment reservation reduced or released", {
      reservationId: reservation.id,
      eventId: line.eventId,
      equipmentRequestId: line.id,
      previousQuantity: reservation.quantity,
      quantity: input.quantity,
      arrangementStatus,
    });

    return {
      equipmentRequestId: line.id,
      previousQuantity: reservation.quantity,
      quantity: input.quantity,
      released: input.quantity === 0,
      arrangementStatus,
      notificationQueued,
    };
  });

  return result;
}
