import { and, count, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, notifications, venueRequests } from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { connectedEventCondition } from "#/features/events/records.server";
import {
  notificationHref,
  notificationReachable,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";
import type { NotificationHrefFacts } from "#/features/notifications/message";
import { parseMarkNotificationsReadInput } from "#/features/notifications/schema";
import { logger } from "#/lib/logger";

type Database = typeof Db;

const log = logger.getChild("notifications");

/** Newest first; no pagination until the inbox needs it. */
const INBOX_LIMIT = 50;

/**
 * PTR-55: one row as the inbox renders it. A row whose subject the caller can no longer reach is
 * neutralised — null summary, null href, and nothing of the payload or kind crosses the network —
 * so opening it cannot expose event data (AC5); `read` is the caller's own state and still shows
 * (PTR-56). `createdAt` is ISO. The page consumes this shape as `NotificationListItem`, derived
 * from the server function's return.
 */
interface NotificationListItem {
  id: number;
  createdAt: string;
  read: boolean;
  summary: string | null;
  href: string | null;
}

/**
 * The signed-in user's notifications, newest first (AC1), scoped to their recipient id (AC3).
 * Reachability comes from the same SQL relationship rule the event pages use (PTR-8). Two kinds
 * carry their own right of access, and `notificationReachable` states that rule (PTR-145 retires
 * the handover, whose record stays readable). The reachability reads are scoped to the page's own
 * event ids, so they never sweep the caller's whole event set.
 */
export async function handleListNotifications(
  actor: SessionUser,
  database: Pick<Database, "select">
): Promise<NotificationListItem[]> {
  const rows = await database
    .select({
      id: notifications.id,
      eventRequestId: notifications.eventRequestId,
      kind: notifications.kind,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.recipientId, actor.id))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(INBOX_LIMIT);

  if (rows.length === 0) return [];

  const eventIds = [...new Set(rows.map(row => row.eventRequestId))];
  const condition = connectedEventCondition(database, actor);
  // One extra read only when the inbox holds venue-staff rows: the href for a settled request
  // depends on what the request became, and that status is not part of the notification payload.
  const venueRequestIds = rows.flatMap(row => {
    const parsed = parseNotificationPayload(row.kind, row.payload);
    return parsed?.kind === "venue_booking_requested" ? [parsed.payload.venueRequestId] : [];
  });
  // Run the reads in order: `handleReadInbox` calls this inside one transaction, and the
  // transaction handle serves one query at a time.
  const accessibleRows =
    condition === undefined
      ? []
      : await database
          .select({ id: eventRequests.id })
          .from(eventRequests)
          .where(and(condition, inArray(eventRequests.id, eventIds)));
  const venueRequestStatusRows =
    venueRequestIds.length === 0
      ? []
      : await database
          .select({ id: venueRequests.id, status: venueRequests.status })
          .from(venueRequests)
          .where(inArray(venueRequests.id, venueRequestIds));
  const accessibleEventIds = new Set(accessibleRows.map(row => row.id));
  const venueRequestStatuses = new Map(venueRequestStatusRows.map(row => [row.id, row.status]));

  return rows.map(row => {
    const item = (summary: string | null, href: string | null): NotificationListItem => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
      summary,
      href,
    });
    const parsed = parseNotificationPayload(row.kind, row.payload);
    if (!parsed) {
      // A row no renderer understands stays listed but says nothing; it is still the recipient's.
      log.warn("Notification payload did not parse", { notificationId: row.id, kind: row.kind });
      return item(null, null);
    }

    const reachable = notificationReachable(parsed, {
      eventAccessible: accessibleEventIds.has(row.eventRequestId),
    });
    if (!reachable) {
      return item(null, null);
    }

    const facts: NotificationHrefFacts = {};
    if (parsed.kind === "venue_booking_requested") {
      facts.venueRequestStatus = venueRequestStatuses.get(parsed.payload.venueRequestId) ?? null;
    }

    return item(
      notificationSummary(parsed),
      notificationHref({ ...parsed, eventRequestId: row.eventRequestId }, facts)
    );
  });
}

/**
 * PTR-56: how many of the caller's notifications are unread, across all of them rather than only
 * the listed page, so the count stays true past the inbox limit.
 */
export async function handleCountUnreadNotifications(
  actor: SessionUser,
  database: Pick<Database, "select">
): Promise<number> {
  const [row] = await database
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, actor.id), isNull(notifications.readAt)));
  return row.unread;
}

/**
 * PTR-56: the inbox page's data — the listed rows and the unread count — read in one read-only
 * repeatable-read snapshot, so a notification raised between the two reads cannot leave the count
 * disagreeing with the rows it sits above.
 */
export async function handleReadInbox(
  actor: SessionUser,
  database: Database
): Promise<{ notifications: NotificationListItem[]; unreadCount: number }> {
  return database.transaction(
    async tx => ({
      notifications: await handleListNotifications(actor, tx),
      unreadCount: await handleCountUnreadNotifications(actor, tx),
    }),
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

/**
 * PTR-56 AC3: marks one notification read (`id`), or every notification up to the highest id the
 * caller was shown (`throughId`), so a row with a higher id than any shown stays unread. Scoped to
 * the caller, so another user's id changes nothing; an already-read row keeps its first read time.
 */
export async function handleMarkNotificationsRead(
  data: unknown,
  actor: SessionUser,
  database: Pick<Database, "update">
): Promise<void> {
  const input = parseMarkNotificationsReadInput(data);
  // ponytail: serial ids follow insert order, not commit order, so a lower-id row committing after
  // the page rendered is marked read unseen; a per-user read watermark fixes that if it matters.
  const target =
    "id" in input ? eq(notifications.id, input.id) : lte(notifications.id, input.throughId);
  await database
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.recipientId, actor.id), isNull(notifications.readAt), target));
}
