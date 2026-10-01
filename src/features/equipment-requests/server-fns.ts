import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import {
  parseArrangementUpdateInput,
  parseAvailabilityCheckInput,
  parseCheckLineAvailabilityInput,
  parseCompleteArrangementsInput,
  parseEquipmentLineInput,
  parseRecordUnavailableInput,
  parseReleaseEquipmentInput,
  parseRemoveEquipmentLineInput,
  parseReserveEquipmentInput,
  parseSubmitEquipmentInput,
} from "#/features/equipment-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("equipment-requests");

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./equipment.server` and `#/db` are both reached inside the
 * handlers, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/equipment-requests/equipment.server")]);
}

export const requireEquipmentManage = requirePermission({
  equipment_request: ["manage"],
});

export const requireEquipmentSubmit = requirePermission({
  equipment_request: ["submit"],
});

export const requireEquipmentArrange = requirePermission({
  equipment_request: ["arrange"],
});

/**
 * PTR-39 AC3: Technical Support sets a line's arrangement state, adds notes, or both. The work
 * list and the request detail need no function of their own: they read the caller's events
 * through `listEvents`, which already scopes and projects them.
 */
export const updateEquipmentArrangement = createServerFn({ method: "POST" })
  .validator(parseArrangementUpdateInput)
  .middleware([requireEquipmentArrange])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleUpdateArrangement }] = await loadServer();
    const line = await handleUpdateArrangement(data, context.user, db);

    log.info("Equipment arrangement updated", {
      lineId: line.id,
      eventId: line.eventId,
      state: line.arrangementStatus,
      actorId: context.user.id,
    });

    return line;
  });

/**
 * PTR-43 AC1: Technical Support Staff marks an event's technical arrangements complete.
 * Refused if any line is not in 'reserved' or 'not_required'.
 */
export const completeEquipmentArrangements = createServerFn({ method: "POST" })
  .validator(parseCompleteArrangementsInput)
  .middleware([requireEquipmentArrange])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCompleteArrangements }] = await loadServer();
    const event = await handleCompleteArrangements(data, context.user, db);

    log.info("Equipment arrangements marked complete", {
      eventId: event.id,
      actorId: context.user.id,
    });

    return event;
  });

/**
 * PTR-43 AC2: Technical Support Staff records that requested equipment cannot be provided.
 * Stores the reason and notifies the assigned Coordinator.
 */
export const recordEquipmentUnavailable = createServerFn({ method: "POST" })
  .validator(parseRecordUnavailableInput)
  .middleware([requireEquipmentArrange])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRecordUnavailable }] = await loadServer();
    const line = await handleRecordUnavailable(data, context.user, db);

    log.info("Equipment recorded unavailable", {
      lineId: line.id,
      eventId: line.eventId,
      reason: line.unavailableReason,
      actorId: context.user.id,
    });

    return line;
  });

/** PTR-38 AC1/AC4: add a new line or update an existing one. */
export const saveEquipmentLine = createServerFn({ method: "POST" })
  .validator(parseEquipmentLineInput)
  .middleware([requireEquipmentManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveEquipmentLine }] = await loadServer();
    const line = await handleSaveEquipmentLine(data, context.user, db);

    log.info("Equipment line saved", {
      lineId: line.id,
      eventId: line.eventId,
      actorId: context.user.id,
    });

    return line;
  });

/** PTR-38 AC4: remove one line. */
export const removeEquipmentLine = createServerFn({ method: "POST" })
  .validator(parseRemoveEquipmentLineInput)
  .middleware([requireEquipmentManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRemoveEquipmentLine }] = await loadServer();
    const line = await handleRemoveEquipmentLine(data, context.user, db);

    log.info("Equipment line removed", {
      lineId: line.id,
      eventId: line.eventId,
      actorId: context.user.id,
    });

    return line;
  });

/**
 * PTR-38 AC5: submit the full equipment list to Technical Support. The handler sends the
 * notification after the commit; mail failures are logged and swallowed there, matching the
 * best-effort pattern venue requests use.
 */
export const submitEquipmentRequest = createServerFn({ method: "POST" })
  .validator(parseSubmitEquipmentInput)
  .middleware([requireEquipmentSubmit])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSubmitEquipmentRequest }] = await loadServer();
    const result = await handleSubmitEquipmentRequest(data, context.user, db);

    log.info("Equipment request submitted to Technical Support", {
      eventId: data.eventId,
      actorId: context.user.id,
      lineCount: result.lineCount,
      recipientCount: result.recipientCount,
      failedCount: result.failedCount,
    });

    return result;
  });

/** PTR-40: how much of an equipment type is free for the event's approved booking period. */
export const checkEquipmentAvailability = createServerFn({ method: "POST" })
  .validator(parseAvailabilityCheckInput)
  .middleware([requireEquipmentArrange])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCheckEquipmentAvailability }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/availability.server"),
    ]);
    return handleCheckEquipmentAvailability(data, context.user, db);
  });

/** PTR-40: the equipment types Technical Support can check, for the availability picker. */
export const listEquipmentTypes = createServerFn({ method: "GET" })
  .middleware([requireEquipmentArrange])
  .handler(async () => {
    const [{ db }, { handleListEquipmentTypes }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/availability.server"),
    ]);
    return handleListEquipmentTypes(db);
  });

/** PTR-41: Technical Support Staff reserve equipment for an event's approved venue booking period. */
export const requireEquipmentReserve = requirePermission({ equipment: ["reserve"] });

export const reserveEquipment = createServerFn({ method: "POST" })
  .validator(parseReserveEquipmentInput)
  .middleware([requireEquipmentReserve])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleReserveEquipment }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/reservations.server"),
    ]);
    return handleReserveEquipment(data, context.user, db);
  });

/** PTR-41: how much of the line's own type is free for its booking window. */
export const checkLineAvailability = createServerFn({ method: "POST" })
  .validator(parseCheckLineAvailabilityInput)
  .middleware([requireEquipmentReserve])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCheckLineAvailability }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/reservations.server"),
    ]);
    return handleCheckLineAvailability(data, context.user, db);
  });

/** PTR-42: Technical Support Staff reduce a line's reservation to a new total, or release it. */
export const requireEquipmentRelease = requirePermission({ equipment: ["release"] });

export const releaseEquipment = createServerFn({ method: "POST" })
  .validator(parseReleaseEquipmentInput)
  .middleware([requireEquipmentRelease])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleReleaseEquipment }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/reservations.server"),
    ]);
    return handleReleaseEquipment(data, context.user, db);
  });
