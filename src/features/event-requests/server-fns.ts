import { createServerFn } from "@tanstack/react-start";

import { AuthorizationError, getCurrentUser } from "#/features/auth/session";
import { parseDraftInput } from "#/features/event-requests/schema";

/**
 * Routes import this module, so it must stay free of any static server import — `./drafts.server`
 * and `#/db` are both reached inside the handler, which TanStack Start strips from the client
 * build. Everything else here (`parseDraftInput`, the session helpers) is pure and client-safe.
 */
export const saveEventRequestDraft = createServerFn({ method: "POST" })
  .validator(parseDraftInput)
  .handler(async ({ data }) => {
    const [user, { db }, { handleSaveEventRequestDraft }] = await Promise.all([
      getCurrentUser(),
      import("#/db"),
      import("#/features/event-requests/drafts.server"),
    ]);

    try {
      return await handleSaveEventRequestDraft(data, user, db);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw new Response(error.message, { status: error.status });
      }
      throw error;
    }
  });
