import { createServerFn } from "@tanstack/react-start";

import { parseAssignmentInput, parseDecisionInput } from "#/features/coordination/schema";
import { parseClarificationBody, parseEventRequestId } from "#/features/event-requests/schema";
import {
  requireEventRequestAssign,
  requireEventRequestCoordinate,
  requireEventRequestOversee,
} from "#/features/event-requests/server-fns";
import { logger } from "#/lib/logger";

const log = logger.getChild("coordination");

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./assignments.server` and `#/db` are both reached inside the
 * handlers, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/coordination/assignments.server")]);
}

export type Coordinator = Awaited<ReturnType<typeof listCoordinators>>[number];
export type CoordinationRequest = Awaited<ReturnType<typeof getCoordinationRequest>>;
/** A request already assigned to the signed-in Coordinator, as the coordination page sees it. */
export type AssignedEventRequest = Awaited<ReturnType<typeof listAssignedEventRequests>>[number];
/** PTR-149: one Coordinator and every event assigned to them, as the Lead's oversight list sees it. */
export type CoordinatorOversight = Awaited<ReturnType<typeof listCoordinatorOversight>>[number];

export const listAssignedEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .handler(async ({ context }) => {
    const [{ db }, { handleListAssignedEventRequests }] = await loadServer();
    return handleListAssignedEventRequests(context.user, db);
  });

/**
 * PTR-145 criterion 6: every Event Coordinator as an assignment candidate. The Lead chooses an
 * assignment from this list; the UI filters and ranks nothing.
 */
export const listCoordinators = createServerFn({ method: "GET" })
  .middleware([requireEventRequestAssign])
  .handler(async () => {
    const [{ db }, { handleListCoordinators }] = await loadServer();
    return handleListCoordinators(db);
  });

/**
 * PTR-149 criterion 1: every Coordinator with their assigned events, system-wide. The same read
 * opens no event by itself; each row links to the event page, whose access still decides.
 */
export const listCoordinatorOversight = createServerFn({ method: "GET" })
  .middleware([requireEventRequestOversee])
  .handler(async () => {
    const [{ db }, { handleListCoordinatorOversight }] = await loadServer();
    return handleListCoordinatorOversight(db);
  });

export const getCoordinationRequest = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetCoordinationRequest }] = await loadServer();
    return handleGetCoordinationRequest(data, context.user, db);
  });

/**
 * PTR-144: the Lead's read of a request. PTR-145 uses it for the unassigned queue detail and for
 * the assignment form on an assigned event. The handler re-reads the caller's scope.
 */
export const getOversightRequest = createServerFn({ method: "GET" })
  .middleware([requireEventRequestOversee])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetCoordinationRequest }] = await loadServer();
    return handleGetCoordinationRequest(data, context.user, db);
  });

/**
 * PTR-145 criteria 1, 2 and 8: the Lead assigns or reassigns a Coordinator. The move is immediate
 * and records the acting Lead and the time; a stale expected Coordinator is refused.
 */
export const assignEventRequest = createServerFn({ method: "POST" })
  .middleware([requireEventRequestAssign])
  .validator(parseAssignmentInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleAssignEventRequest }] = await loadServer();
    const request = await handleAssignEventRequest(data, context.user, db);

    log.info("Event request assignment moved", {
      requestId: request.id,
      actorId: context.user.id,
      coordinatorId: request.assignedCoordinatorId,
    });

    return request;
  });

/**
 * PTR-17 criterion 3: the assigned Coordinator marks a submitted request as under review.
 * The handler enforces ownership, so a different Coordinator is refused 403.
 */
export const takeUpEventRequestForReview = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleTakeUpForReview }] = await loadServer();
    const request = await handleTakeUpForReview(data, context.user, db);

    log.info("Event request taken up for review", {
      requestId: request.id,
      actorId: context.user.id,
    });

    return request;
  });

/** PTR-20: decide an under-review request and notify its Organiser of the recorded outcome. */
export const decideEventRequest = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseDecisionInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDecideEventRequest }] = await loadServer();
    const request = await handleDecideEventRequest(data, context.user, db);

    log.info("Event request decision recorded", {
      requestId: request.id,
      actorId: context.user.id,
      decision: request.status,
    });

    return request;
  });

/**
 * PTR-18: the assigned Coordinator raises a clarification request for an event under review.
 */
export const raiseClarificationRequest = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseClarificationBody)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRaiseClarificationRequest }] = await loadServer();
    const clarification = await handleRaiseClarificationRequest(data, context.user, db);

    log.info("Clarification request raised", {
      requestId: data.id,
      actorId: context.user.id,
      clarificationId: clarification.id,
    });

    return clarification;
  });
