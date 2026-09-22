import { createServerFn } from "@tanstack/react-start";

import { parseAssignmentInput, parseDecisionInput } from "#/features/coordination/schema";
import { parseClarificationBody, parseEventRequestId } from "#/features/event-requests/schema";
import { requireEventRequestCoordinate } from "#/features/event-requests/server-fns";
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

export const listAssignedEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .handler(async ({ context }) => {
    const [{ db }, { handleListAssignedEventRequests }] = await loadServer();
    return handleListAssignedEventRequests(context.user, db);
  });

export const listCoordinators = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .handler(async () => {
    const [{ db }, { handleListCoordinators }] = await loadServer();
    return handleListCoordinators(db);
  });

export const getCoordinationRequest = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetCoordinationRequest }] = await loadServer();
    return handleGetCoordinationRequest(data, context.user, db);
  });

export const assignEventRequest = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseAssignmentInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleAssignEventRequest }] = await loadServer();
    const request = await handleAssignEventRequest(data, context.user, db);

    log.info("Event request assigned", {
      requestId: request.id,
      actorId: context.user.id,
      fromCoordinatorId: data.expectedCoordinatorId,
      toCoordinatorId: request.assignedCoordinatorId,
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
    const [{ db }, { handleDecideEventRequest, sendEventDecisionNotification }] =
      await loadServer();
    const request = await handleDecideEventRequest(
      data,
      context.user,
      db,
      sendEventDecisionNotification
    );

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
