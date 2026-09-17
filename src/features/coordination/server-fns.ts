import { createServerFn } from "@tanstack/react-start";

import { parseAssignmentInput } from "#/features/coordination/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";
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
