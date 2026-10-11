import { createServerFn } from "@tanstack/react-start";

import { requirePermission, requireSession } from "#/features/auth/session";
import {
  parseEventCancellationDeclineInput,
  parseEventChangeRequestDeclineInput,
  parseEventInformationInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { requireEventRequestCoordinate } from "#/features/event-requests/server-fns";
import {
  parseEventListInput,
  parseVipRegistrationInput,
  parseVipSearchInput,
} from "#/features/events/schema";
import { logger } from "#/lib/logger";

const requireEventRegistrationRead = requirePermission({ event_registration: ["read"] });

const log = logger.getChild("events");

/**
 * Routes import this module, so do not add static server imports here. Middleware must remain
 * client-safe. The handlers import `*.server` modules and `#/db` dynamically; TanStack Start
 * removes the handlers from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/events/records.server")]);
}

async function loadConfirmServer() {
  return Promise.all([import("#/db"), import("#/features/events/confirm.server")]);
}

async function loadCancelServer() {
  return Promise.all([import("#/db"), import("#/features/events/cancel.server")]);
}

async function loadRegisterServer() {
  return Promise.all([import("#/db"), import("#/features/events/register.server")]);
}

async function loadWithdrawServer() {
  return Promise.all([import("#/db"), import("#/features/events/withdraw.server")]);
}

async function loadCompleteServer() {
  return Promise.all([import("#/db"), import("#/features/events/complete.server")]);
}

async function loadUpdateServer() {
  return Promise.all([import("#/db"), import("#/features/events/update.server")]);
}

async function loadArrangementsServer() {
  return Promise.all([import("#/db"), import("#/features/events/arrangements.server")]);
}

const requireEventRegister = requirePermission({ event: ["register"] });
const requireVipRegistrationManage = requirePermission({ vip_registration: ["manage"] });

/**
 * PTR-8: List the events the signed-in user connects to, each in a role-specific projection. No
 * `can()` permission fits. The relationship is data, not a role. The pipeline only establishes
 * the session. `records.server` scopes and refuses per row. Naming an unconnected event answers
 * the generic 403 with no event data.
 */
export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(parseEventListInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleListEvents }] = await loadServer();
    return handleListEvents(data, context.user, db);
  });

/**
 * PTR-24: The assigned Coordinator confirms an event with venue and equipment arrangements in
 * place. The handler re-reads the assignment and the arrangements. The permission only states
 * that the caller may coordinate.
 */
export const confirmEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleConfirmEvent }] = await loadConfirmServer();
    const event = await handleConfirmEvent(data, context.user, db);

    log.info("Event confirmed", { eventId: event.id, actorId: context.user.id });

    return event;
  });

/**
 * PTR-22: The assigned Coordinator updates information on an approved, planning, or confirmed
 * event. The handler re-reads the assignment and the status. The permission only states that the
 * caller may coordinate.
 */
export const updateEventInformation = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventInformationInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleUpdateEventInformation }] = await loadUpdateServer();
    const result = await handleUpdateEventInformation(data, context.user, db);

    if (result.changedFields.length > 0) {
      log.info("Event information updated", {
        eventId: data.id,
        actorId: context.user.id,
        changedFields: result.changedFields,
        notified: result.notified,
        changeRequestId: data.changeRequestId,
      });
    }

    return result;
  });

/**
 * PTR-23 AC3: Read what an event holds before saving a significant change. The warning then names
 * each booking, hold, and reservation. The handler re-reads the assignment. The permission only
 * states that the caller may coordinate. Reading changes nothing.
 */
export const listEventArrangements = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleListEventArrangements }] = await loadArrangementsServer();
    return handleListEventArrangements(data, context.user, db);
  });

/**
 * PTR-54: The assigned Coordinator cancels the event named by a waiting cancellation request. The
 * handler re-reads the assignment and the request. The permission only states that the caller may
 * coordinate. The coordination page then lists what the event still holds.
 */
export const cancelEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCancelEvent }] = await loadCancelServer();
    const event = await handleCancelEvent(data, context.user, db);

    log.info("Event cancelled", { eventId: event.id, actorId: context.user.id });
  });

/**
 * PTR-52 AC2: The assigned Coordinator declines a waiting change request with a reason. The
 * handler re-reads the assignment and the request. The permission only states that the caller may
 * coordinate. Apply a request through `updateEventInformation` with `changeRequestId`.
 */
export const declineEventChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventChangeRequestDeclineInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDeclineEventChangeRequest }] = await loadUpdateServer();
    const declined = await handleDeclineEventChangeRequest(data, context.user, db);

    log.info("Event change request declined", {
      eventId: data.id,
      changeRequestId: declined.id,
      actorId: context.user.id,
    });
  });

/** PTR-54 AC8: The assigned Coordinator declines a waiting cancellation request with a reason. */
export const declineEventCancellation = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventCancellationDeclineInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDeclineEventCancellation }] = await loadCancelServer();
    const declined = await handleDeclineEventCancellation(data, context.user, db);

    log.info("Event cancellation declined", {
      eventId: data.id,
      cancellationRequestId: declined.id,
      actorId: context.user.id,
    });
  });

/**
 * PTR-45: An Attendee registers for a published event. A visitor gets 401. Any other role gets
 * 403 (AC1). The handler re-reads the event, its period, and its places. The permission only
 * states that the caller may register.
 */
export const registerForEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRegister])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRegisterForEvent }] = await loadRegisterServer();
    const registration = await handleRegisterForEvent(data, context.user, db);

    log.info("Event registration recorded", { eventId: data.id, attendeeId: context.user.id });

    return registration;
  });

/**
 * PTR-47: An Attendee withdraws from a registered event. Middleware checks the session and the
 * `event:register` permission.
 */
export const withdrawFromEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRegister])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleWithdrawFromEvent }] = await loadWithdrawServer();
    const placeFreedAtCapacity = await handleWithdrawFromEvent(data, context.user, db);

    log.info("Event registration withdrawn", { eventId: data.id, attendeeId: context.user.id });
    return placeFreedAtCapacity;
  });

/**
 * PTR-111: Search Attendee accounts by part of the name or email. The Organiser or the assigned
 * Coordinator can add them as VIPs. Every other role gets 403. The handler re-reads the caller's
 * relationship to the event. Use POST, so searched names and emails stay out of the URL and the
 * request logs.
 */
export const searchVipAttendees = createServerFn({ method: "POST" })
  .middleware([requireVipRegistrationManage])
  .validator(parseVipSearchInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSearchVipAttendees }] = await loadRegisterServer();
    return handleSearchVipAttendees(data, context.user, db);
  });

/**
 * PTR-111: The Organiser or the assigned Coordinator adds a VIP registration for an Attendee
 * account. Every other role gets 403. The handler re-reads the event, the caller's relationship
 * to it, and the venue places.
 */
export const addVipRegistration = createServerFn({ method: "POST" })
  .middleware([requireVipRegistrationManage])
  .validator(parseVipRegistrationInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleAddVipRegistration }] = await loadRegisterServer();
    await handleAddVipRegistration(data, context.user, db);

    log.info("VIP registration recorded", {
      eventId: data.id,
      attendeeId: data.attendeeId,
      actorId: context.user.id,
    });
  });

/** PTR-111 AC6: The Organiser or the assigned Coordinator removes a VIP registration. */
export const removeVipRegistration = createServerFn({ method: "POST" })
  .middleware([requireVipRegistrationManage])
  .validator(parseVipRegistrationInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRemoveVipRegistration }] = await loadRegisterServer();
    await handleRemoveVipRegistration(data, context.user, db);

    log.info("VIP registration removed", {
      eventId: data.id,
      attendeeId: data.attendeeId,
      actorId: context.user.id,
    });
  });

/** PTR-25: Only an Event Coordinator reaches the handler. It re-checks the live assignment. */
export const completeEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCompleteEvent }] = await loadCompleteServer();
    const event = await handleCompleteEvent(data, context.user, db);

    log.info("Event completed", { eventId: event.id, actorId: context.user.id });

    return event;
  });

/**
 * PTR-48: List the attendees registered for an event. Only the event's Organiser or assigned
 * Coordinator can view this list.
 */
export const listEventRegistrations = createServerFn({ method: "GET" })
  .middleware([requireEventRegistrationRead])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleListEventRegistrations }] = await loadServer();
    return await handleListEventRegistrations(data, context.user, db);
  });
