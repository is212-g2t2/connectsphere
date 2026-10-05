import { createServerFn } from "@tanstack/react-start";

import { requirePermission, requireSession } from "#/features/auth/session";
import {
  parseEventCancellationDeclineInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { requireEventRequestCoordinate } from "#/features/event-requests/server-fns";
import {
  parseEventListInput,
  parseVipRegistrationInput,
  parseVipSearchInput,
} from "#/features/events/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("events");

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./records.server` and `#/db` are both reached inside the handler,
 * which TanStack Start strips from the client build.
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

async function loadCompleteServer() {
  return Promise.all([import("#/db"), import("#/features/events/complete.server")]);
}

const requireEventRegister = requirePermission({ event: ["register"] });
const requireVipRegistrationManage = requirePermission({ vip_registration: ["manage"] });

/**
 * PTR-8: the events the signed-in user is connected to, each in a role-specific projection. No
 * `can()` permission fits — the relationship is data, not a role — so the pipeline only
 * establishes the session and `records.server` scopes and refuses per row. Naming an event the
 * caller is not connected to answers the generic 403 with no event data.
 */
export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(parseEventListInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleListEvents }] = await loadServer();
    return handleListEvents(data, context.user, db);
  });

/**
 * PTR-24: the assigned Coordinator confirms an event once its venue and equipment arrangements are
 * in place. The handler re-reads the assignment and the arrangements, so the permission says only
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
 * PTR-54: the assigned Coordinator cancels the event a waiting cancellation request asks for. The
 * handler re-reads the assignment and the request, so the permission says only that the caller
 * may coordinate. The answer lists what the event still holds, for the staff to release.
 */
export const cancelEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCancelEvent }] = await loadCancelServer();
    const { event, outstandingReleases } = await handleCancelEvent(data, context.user, db);

    log.info("Event cancelled", { eventId: event.id, actorId: context.user.id });

    return { outstandingReleases };
  });

/** PTR-54 AC8: the assigned Coordinator declines a waiting cancellation request, with a reason. */
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
 * PTR-45: an Attendee registers for a published event. A visitor gets 401 and any other role gets
 * 403 (AC1). The handler re-reads the event, its period and its places, so the permission says
 * only that the caller may register.
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
 * PTR-111: the Attendee accounts that the Organiser or the assigned Coordinator can add as a VIP,
 * by part of the name or the email. Every other role gets 403, and the handler re-reads the
 * caller's relationship to the event, so no one else can search the Attendees through it. POST,
 * so the names and emails searched for stay out of the URL and the request logs.
 */
export const searchVipAttendees = createServerFn({ method: "POST" })
  .middleware([requireVipRegistrationManage])
  .validator(parseVipSearchInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSearchVipAttendees }] = await loadRegisterServer();
    return handleSearchVipAttendees(data, context.user, db);
  });

/**
 * PTR-111: the Organiser or the assigned Coordinator adds a VIP registration for an Attendee
 * account. Every other role gets 403. The handler re-reads the event, the caller's relationship to
 * it, and the venue places.
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

/** PTR-111 AC6: the Organiser or the assigned Coordinator removes a VIP registration. */
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

/** PTR-25: only an Event Coordinator reaches the handler; it re-checks the live assignment. */
export const completeEvent = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCompleteEvent }] = await loadCompleteServer();
    const event = await handleCompleteEvent(data, context.user, db);

    log.info("Event completed", { eventId: event.id, actorId: context.user.id });

    return event;
  });
