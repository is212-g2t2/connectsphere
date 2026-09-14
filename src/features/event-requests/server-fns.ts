import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import { parseDraftInput } from "#/features/event-requests/schema";

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
