import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import {
  parseArrangementUpdateInput,
  parseAvailabilityCheckInput,
  parseCheckLineAvailabilityInput,
  parseCompleteArrangementsInput,
  parseEquipmentLineInput,
  parseEquipmentTypeId,
  parseEquipmentTypeInput,
  parseEquipmentUnavailabilityInput,
  parseMapEquipmentLineInput,
  parseRecordUnavailableInput,
  parseReleaseEquipmentInput,
  parseRemoveEquipmentLineInput,
  parseReserveEquipmentInput,
  parseSubmitEquipmentInput,
} from "#/features/equipment-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("equipment-requests");

/**
 * Routes import this module, so do not add static server imports here. The middleware can run on
 * the client. Load `./equipment.server` and `#/db` inside handlers. TanStack Start removes them
 * from the client build.
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

/** PTR-162: Technical Support maintains the equipment catalogue. Catalogue writes use this
 * verb, never `equipment_request:arrange`. */
export const requireEquipmentTypeManage = requirePermission({
  equipment_type: ["manage"],
});

/**
 * PTR-39 AC3: Technical Support sets a line's state, adds notes, or does both. The work list and
 * request detail use `listEvents` to read the caller's events. That function applies access rules
 * and selects the required fields.
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

/** PTR-43 AC1: Mark technical arrangements complete if each line is `reserved` or `not_required`. */
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

/** PTR-43 AC2: Record why Technical Support cannot provide the requested equipment. Notify the assigned Coordinator. */
export const recordEquipmentUnavailable = createServerFn({ method: "POST" })
  .validator(parseRecordUnavailableInput)
  .middleware([requireEquipmentArrange])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRecordUnavailable }] = await loadServer();
    const line = await handleRecordUnavailable(data, context.user, db);

    log.info("Equipment recorded unavailable", {
      lineId: line.id,
      eventId: line.eventId,
      reasonLength: line.unavailableReason?.length ?? 0,
      actorId: context.user.id,
    });

    return line;
  });

/** PTR-38 AC1/AC4: Add a line or update an existing line. */
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

/** PTR-38 AC4: Remove one line. */
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
 * PTR-38 AC5: Submit the full equipment list to Technical Support. The handler creates a
 * notification for each Technical Support member. The worker sends the emails.
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
    });

    return result;
  });

/** PTR-40: Check how many units of an equipment type are free during the event's approved booking. */
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

/** PTR-162: the catalogue list. Technical Support maintains the catalogue, so the list uses the catalogue-manage verb, as its route guard does. */
export const listEquipmentTypes = createServerFn({ method: "GET" })
  .middleware([requireEquipmentTypeManage])
  .handler(async () => {
    const [{ db }, { handleListEquipmentTypes }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/availability.server"),
    ]);
    return handleListEquipmentTypes(db);
  });

/** PTR-162 AC1: add a type or change its quantity held. Technical Support maintains the catalogue. */
export const saveEquipmentType = createServerFn({ method: "POST" })
  .validator(parseEquipmentTypeInput)
  .middleware([requireEquipmentTypeManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveEquipmentType }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/availability.server"),
    ]);
    const type = await handleSaveEquipmentType(data, context.user, db);

    log.info("Equipment type saved", {
      equipmentTypeId: type.id,
      name: type.name,
      actorId: context.user.id,
    });

    return type;
  });

/** PTR-162 AC4: delete a type that no line or reservation references. */
export const deleteEquipmentType = createServerFn({ method: "POST" })
  .validator(parseEquipmentTypeId)
  .middleware([requireEquipmentTypeManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDeleteEquipmentType }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/availability.server"),
    ]);
    const type = await handleDeleteEquipmentType(data, context.user, db);

    log.info("Equipment type deleted", {
      equipmentTypeId: type.id,
      actorId: context.user.id,
    });

    return type;
  });

/** PTR-162 AC2: record or change the out-of-service quantity for one type and reason. */
export const saveEquipmentUnavailability = createServerFn({ method: "POST" })
  .validator(parseEquipmentUnavailabilityInput)
  .middleware([requireEquipmentTypeManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveEquipmentUnavailability }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/availability.server"),
    ]);
    const row = await handleSaveEquipmentUnavailability(data, context.user, db);

    log.info("Equipment out-of-service quantity saved", {
      equipmentTypeId: row.equipmentTypeId,
      actorId: context.user.id,
    });

    return row;
  });

/** PTR-162 AC5: map a free-text line to a catalogue type so reserve works. */
export const mapEquipmentLine = createServerFn({ method: "POST" })
  .validator(parseMapEquipmentLineInput)
  .middleware([requireEquipmentArrange])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleMapEquipmentLine }] = await Promise.all([
      import("#/db"),
      import("#/features/equipment-requests/equipment.server"),
    ]);
    const line = await handleMapEquipmentLine(data, context.user, db);

    log.info("Equipment line mapped to type", {
      lineId: line.id,
      equipmentTypeId: line.equipmentTypeId,
      actorId: context.user.id,
    });

    return line;
  });

/** PTR-41: Reserve equipment for an event's approved venue booking period. */
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

/** PTR-41: Check how many units of the line's type are free during its booking. */
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

/** PTR-42: Reduce a line's reservation or release it. */
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
