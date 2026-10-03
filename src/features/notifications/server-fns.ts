import { createServerFn } from "@tanstack/react-start";

import { requireSession } from "#/features/auth/session";
import { parseMarkNotificationsReadInput } from "#/features/notifications/schema";

/**
 * Routes import this module, so it stays free of any static server import — `./inbox.server` and
 * `#/db` are reached inside the handler, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/notifications/inbox.server")]);
}

/**
 * PTR-55 AC1–AC3: the signed-in user's own notifications, newest first, with the PTR-56 unread
 * count across all of them. There is no permission beyond the session: every account may read the
 * notifications addressed to it, and the handlers scope the query by the caller's id.
 */
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const [{ db }, { handleListNotifications, handleCountUnreadNotifications }] =
      await loadServer();
    // One snapshot for both reads, so a notification raised between them cannot leave the count
    // disagreeing with the rows it sits above.
    return db.transaction(
      async tx => ({
        notifications: await handleListNotifications(context.user, tx),
        unreadCount: await handleCountUnreadNotifications(context.user, tx),
      }),
      { isolationLevel: "repeatable read", accessMode: "read only" }
    );
  });

export type NotificationListItem = Awaited<
  ReturnType<typeof listNotifications>
>["notifications"][number];

/**
 * PTR-56 AC3: marks one of the caller's notifications read, or all of them up to the highest id
 * the page showed.
 */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(parseMarkNotificationsReadInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleMarkNotificationsRead }] = await loadServer();
    await handleMarkNotificationsRead(data, context.user, db);
  });
