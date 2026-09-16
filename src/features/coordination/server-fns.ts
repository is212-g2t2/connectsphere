import { createServerFn } from "@tanstack/react-start";

import { parseAssignmentInput } from "#/features/coordination/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { requireEventRequestCoordinate } from "#/features/event-requests/server-fns";

export type Coordinator = Awaited<ReturnType<typeof listCoordinators>>[number];
export type CoordinationRequest = Awaited<ReturnType<typeof getCoordinationRequest>>;

export const listAssignedEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .handler(async ({ context }) => {
    const [{ db }, { handleListAssignedEventRequests }] = await Promise.all([
      import("#/db"),
      import("#/features/coordination/assignments.server"),
    ]);
    return handleListAssignedEventRequests(context.user, db);
  });

export const listCoordinators = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .handler(async () => {
    const [{ db }, { handleListCoordinators }] = await Promise.all([
      import("#/db"),
      import("#/features/coordination/assignments.server"),
    ]);
    return handleListCoordinators(db);
  });

export const getCoordinationRequest = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseEventRequestId)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetCoordinationRequest }] = await Promise.all([
      import("#/db"),
      import("#/features/coordination/assignments.server"),
    ]);
    return handleGetCoordinationRequest(data, context.user, db);
  });

export const assignEventRequest = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCoordinate])
  .validator(parseAssignmentInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleAssignEventRequest }] = await Promise.all([
      import("#/db"),
      import("#/features/coordination/assignments.server"),
    ]);
    return handleAssignEventRequest(data, context.user, db);
  });
