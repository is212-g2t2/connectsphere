import { createServerFn } from "@tanstack/react-start";

import { requireSession } from "#/features/auth/session";

/**
 * Routes import this module, so it stays free of any static server import — `./inbox.server` and
 * `#/db` are reached inside the handler, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/notifications/inbox.server")]);
}

/**
 * PTR-55 AC1–AC3: the signed-in user's own notifications, newest first. There is no permission
 * beyond the session: every account may read the notifications addressed to it, and the handler
 * scopes the query by the caller's id.
 */
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const [{ db }, { handleListNotifications }] = await loadServer();
    return handleListNotifications(context.user, db);
  });

export type NotificationListItem = Awaited<ReturnType<typeof listNotifications>>[number];
