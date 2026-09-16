import { createServerFn } from "@tanstack/react-start";

import { requireSession } from "#/features/auth/session";
import { parseEventListInput } from "#/features/events/schema";

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./records.server` and `#/db` are both reached inside the handler,
 * which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/events/records.server")]);
}

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
