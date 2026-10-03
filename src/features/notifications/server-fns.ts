import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSession } from "#/features/auth/session";

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
    const [notifications, unreadCount] = await Promise.all([
      handleListNotifications(context.user, db),
      handleCountUnreadNotifications(context.user, db),
    ]);
    return { notifications, unreadCount };
  });

export type NotificationListItem = Awaited<
  ReturnType<typeof listNotifications>
>["notifications"][number];

const NOTIFICATION_ID_MESSAGE = "Choose a notification";
const notificationId = z
  .int32({ error: NOTIFICATION_ID_MESSAGE })
  .positive(NOTIFICATION_ID_MESSAGE);

const MarkNotificationsReadInput = z.union(
  [z.object({ id: notificationId }), z.object({ throughId: notificationId })],
  { error: NOTIFICATION_ID_MESSAGE }
);

export function parseMarkNotificationsReadInput(
  input: unknown
): { id: number } | { throughId: number } {
  const parsed = MarkNotificationsReadInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * PTR-56 AC3: marks one of the caller's notifications read, or all of them up to the newest one
 * the page showed.
 */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(parseMarkNotificationsReadInput)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleMarkNotificationsRead }] = await loadServer();
    await handleMarkNotificationsRead(data, context.user, db);
  });
