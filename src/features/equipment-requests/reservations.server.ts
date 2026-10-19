import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  equipmentTypes,
  eventRequests,
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
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { assertEventAcceptsActivity } from "#/features/events/completion";
import { logger } from "#/lib/logger";
import {
  chooseEquipmentBooking,
  selectEquipmentBookings,
} from "#/features/equipment-requests/bookings.server";
import { lockVenue } from "#/features/venue-requests/venue-lock.server";
import { toLocalMinuteValue } from "#/features/venues/availability";

type Database = typeof Db;

const log = logger.getChild("equipment-requests");

/** Reserve and release use this staff gate. It checks the line, queue access, and assignment. */
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

  // Check queue access before returning event details. A refused request reveals only whether
  // the line ID exists. It reveals neither the event nor the state.
  const { submitted } = await loadWorkableLines(database, line.eventId, args.actor);

  if (line.assignedStaffId !== null && line.assignedStaffId !== args.actor.id) {
    throw new AuthorizationError("Equipment request is assigned to another staff member");
  }

  if (!isEquipmentQueueRow(line, args.actor.id, submitted)) {
    throw new AuthorizationError("Forbidden");
  }

  return line;
}

/** Check the line, event, chosen booking, and type. Reserve locks the venue before the event. */
async function loadReservableLine(
  database: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
  args: {
    lineId: string;
    actor: SessionUser;
    lock?: boolean;
    quantity?: number;
    venueRequestId?: string | undefined;
  }
) {
  const line = await loadLineForStaff(database, {
    lineId: args.lineId,
    actor: args.actor,
    lock: args.lock,
  });

  const preview = chooseEquipmentBooking(
    await selectEquipmentBookings(database, [line.eventId]),
    args.venueRequestId
  );
  if (args.lock) await lockVenue(database, preview.venueId);

  // PTR-54 AC9: Do not reserve equipment for a cancelled event. The row lock waits for a
  // cancellation to finish, then reads the new status. Use FOR NO KEY UPDATE because this
  // transaction can clear the completion stamp. FOR KEY SHARE can deadlock when it upgrades.
  const eventQuery = database
    .select({ status: eventRequests.status })
    .from(eventRequests)
    .where(eq(eventRequests.id, line.eventId))
    .limit(1);
  const event = (await (args.lock ? eventQuery.for("no key update") : eventQuery)).at(0);
  assertEventAcceptsActivity(event?.status);
  if (event?.status === "cancelled") throw new ConflictError(CANCELLED_EVENT_ACTIVITY_MESSAGE);

  // Do not overwrite states that Technical Support set. Keep unavailable and not_required until
  // Technical Support changes the line to requested. Apply this check to availability too, so
  // the shown number does not invite a reserve that the server will refuse.
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

  const booking = args.lock
    ? chooseEquipmentBooking(
        await selectEquipmentBookings(database, [line.eventId]),
        args.venueRequestId
      )
    : preview;
  if (booking.id !== preview.id || booking.venueId !== preview.venueId) {
    throw new ConflictError("The venue booking changed. Try again.");
  }
  return { line, equipmentTypeId: effectiveEquipmentTypeId, booking };
}

/**
 * Reserve equipment for an event's approved venue booking period (PTR-41).
 * Store the equipment type, quantity, and booking window at the time of reservation. Later booking
 * changes do not change this reservation. Availability checks use the stored period. A new
 * reservation updates the stored values to match the current booking.
 *
 * - AC1: Set the line to `reserved` when the reserved quantity meets or exceeds the requested quantity.
 * - AC1: Keep the line `requested` when the reservation is partial.
 * - AC2: Return 409 Conflict and state the shortfall when the request exceeds availability.
 * - AC3: Reduce availability for overlapping bookings by the reserved quantity.
 * - AC5: Lock the equipment type row to serialize concurrent reservations.
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
      venueRequestId: input.venueRequestId,
    });

    // Lock the equipment type row to serialize reservations (PTR-41 AC5).
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
          venueRequestId: approvedBooking.id,
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
        venueRequestId: approvedBooking.id,
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

    // A reservation change can move the line out of `reserved` and invalidate prior completion.
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
 * PTR-41: Return availability for the line's equipment type and booking window. Exclude the line's
 * own reservation so it does not reduce its available quantity. Use the approved booking period.
 * This shows which period a new reservation will use.
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
    venueRequestId: input.venueRequestId,
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
 * Reduce a line's reservation or release it (PTR-42).
 *
 * A release only frees units, so it does not need an availability check. The freed units appear in
 * the availability of every overlapping event (criterion 2). Lock the line, then the equipment
 * type, as the reserve path does. This serializes releases and reservations for the same type.
 * Restore the line to `requested`, or set it to `unavailable` with the reason from Technical Support
 * (criterion 1). Do not change the event status (criterion 4). Raise a notification for the assigned
 * Coordinator in the same transaction (criterion 3).
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
    // A reserved line can only be `requested` or `reserved`. The reserve path refuses other states,
    // and arrangement changes cannot edit a line with reserved units. Both states are reset below.

    // Take the same type lock as the reserve path, after the line lock. This serializes both actions.
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
        // Keep the line on the member's list, as the reserve path does.
        assignedStaffId: line.assignedStaffId ?? actor.id,
        lastReleasedByStaffId: actor.id,
        lastReleasedByStaffName: actor.name?.trim() || actor.email,
        lastReleasedAt: new Date(),
        lastReleasedQuantity: reservation.quantity - input.quantity,
      })
      .where(eq(equipmentRequests.id, line.id));

    // PTR-43 AC4: A reduction or release invalidates the prior completion stamp.
    await clearArrangementsCompletion(tx, line.eventId);

    // PTR-42 criterion 3: Commit the Coordinator's notice with this change. A mail outage cannot
    // remove the record of the released units; the worker sends the email later.
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
