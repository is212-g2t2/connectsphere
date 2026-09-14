import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import { parseDraftInput, parseEventRequestId } from "#/features/event-requests/schema";

export const requireEventRequestCreate = requirePermission({ event_request: ["create"] });

/** A saved draft as the client sees it — derived here so no route has to import the server module. */
export type EventRequestDraft = Awaited<ReturnType<typeof saveEventRequestDraft>>;

/**
 * Routes import this module, so it must stay free of any static server import — the middleware
 * pipeline is client-safe, and `./drafts.server` and `#/db` are both reached inside the handler,
 * which TanStack Start strips from the client build.
 */
export const saveEventRequestDraft = createServerFn({ method: "POST" })
  .validator(parseDraftInput)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveEventRequestDraft }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/drafts.server"),
    ]);

    return handleSaveEventRequestDraft(data, context.user, db);
  });

/**
 * PTR-13: submits a saved draft by id, so the page never has to carry a payload that was not
 * stored. The same `event_request:create` the save path needs is the permission to submit one's
 * own request; the storage-level status scoping is what keeps it to that organiser's own draft.
 */
export const submitEventRequest = createServerFn({ method: "POST" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSubmitEventRequest }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/drafts.server"),
    ]);

    return handleSubmitEventRequest(data, context.user, db);
  });
