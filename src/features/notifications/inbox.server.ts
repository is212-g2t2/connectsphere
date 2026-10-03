import { and, count, desc, eq, inArray, isNull, lte, notInArray } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventHandovers, eventRequests, notifications, venueRequests } from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { connectedEventCondition } from "#/features/events/records.server";
import {
  notificationHref,
  notificationReachable,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";
import type { NotificationHrefFacts } from "#/features/notifications/message";
import { logger } from "#/lib/logger";

type Database = typeof Db;

const log = logger.getChild("notifications");

/** Newest first; no pagination until the inbox needs it. */
const INBOX_LIMIT = 50;

/**
 * PTR-55: one row as the inbox renders it. A row whose subject the caller can no longer reach is
 * neutralised — null summary, null href, and nothing of the payload or kind crosses the network —
 * so opening it cannot expose event data (AC5). `createdAt` is ISO. The server function re-exports
 * this shape as `NotificationListItem`, the type the page consumes.
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
 * Reachability comes from the same SQL relationship rule the event pages use (PTR-8), with one
 * special case: a `handover_requested` row is reachable while a live handover still names the
 * caller, because the incoming Coordinator is not yet assigned and the event does not connect
 * them yet. The reachability reads are scoped to the page's own event ids, so they never sweep
 * the caller's whole event set.
 */
export async function handleListNotifications(
  actor: SessionUser,
  database: Database
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
  const [accessibleRows, handoverRows] = await Promise.all([
    condition === undefined
      ? Promise.resolve([])
      : database
          .select({ id: eventRequests.id })
          .from(eventRequests)
          .where(and(condition, inArray(eventRequests.id, eventIds))),
    liveHandoverEventIds(actor.id, eventIds, database),
  ]);
  const accessibleEventIds = new Set(accessibleRows.map(row => row.id));
  const pendingHandoverEventIds = new Set(handoverRows);

  // One extra read only when the inbox holds venue-staff rows: the href for a settled request
  // depends on what the request became, and that status is not part of the notification payload.
  const venueRequestIds = rows.flatMap(row => {
    const parsed = parseNotificationPayload(row.kind, row.payload);
    return parsed?.kind === "venue_booking_requested" ? [parsed.payload.venueRequestId] : [];
  });
  const venueRequestStatuses =
    venueRequestIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await database
              .select({ id: venueRequests.id, status: venueRequests.status })
              .from(venueRequests)
              .where(inArray(venueRequests.id, venueRequestIds))
          ).map(row => [row.id, row.status])
        );

  return rows.map(row => {
    const read = row.readAt !== null;
    const parsed = parseNotificationPayload(row.kind, row.payload);
    if (!parsed) {
      // A row no renderer understands stays listed but says nothing; it is still the recipient's.
      log.warn("Notification payload did not parse", { notificationId: row.id, kind: row.kind });
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        read,
        summary: null,
        href: null,
      };
    }

    const handoverPending = pendingHandoverEventIds.has(row.eventRequestId);
    const reachable = notificationReachable(parsed.kind, {
      eventAccessible: accessibleEventIds.has(row.eventRequestId),
      handoverPending,
    });
    if (!reachable) {
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        read,
        summary: null,
        href: null,
      };
    }

    const facts: NotificationHrefFacts = { handoverPending };
    if (parsed.kind === "venue_booking_requested") {
      facts.venueRequestStatus = venueRequestStatuses.get(parsed.payload.venueRequestId) ?? null;
    }

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      read,
      summary: notificationSummary(parsed),
      href: notificationHref({ ...parsed, eventRequestId: row.eventRequestId }, facts),
    };
  });
}

/**
 * PTR-56: how many of the caller's notifications are unread, across all of them rather than only
 * the listed page, so the count stays true past the inbox limit.
 */
export async function handleCountUnreadNotifications(
  actor: SessionUser,
  database: Database
): Promise<number> {
  const [row] = await database
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, actor.id), isNull(notifications.readAt)));
  return row.unread;
}

/**
 * PTR-56 AC3: marks one notification read (`id`), or every notification up to the newest one the
 * caller was shown (`throughId`), so a row raised after the page rendered stays unread. Scoped to
 * the caller, so another user's id changes nothing; an already-read row keeps its first read time.
 */
export async function handleMarkNotificationsRead(
  input: { id: number } | { throughId: number },
  actor: SessionUser,
  database: Database
): Promise<void> {
  // ponytail: serial ids follow insert order, not commit order, so a lower-id row committing after
  // the page rendered is marked read unseen; a per-user read watermark fixes that if it matters.
  const target =
    "id" in input ? eq(notifications.id, input.id) : lte(notifications.id, input.throughId);
  await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, actor.id), isNull(notifications.readAt), target));
}

/**
 * The live handover offers addressed to this Coordinator, mirroring `handleListPendingEventHandovers`:
 * an offer only reaches its recipient while the event still belongs to the Coordinator who made
 * it and the request is not decided. `handleAssignEventRequest` can void an offer by reassigning
 * the event, so the predicate — not the row alone — is what keeps a stale offer from leaking.
 */
async function liveHandoverEventIds(
  userId: string,
  eventIds: readonly number[],
  database: Database
): Promise<number[]> {
  const rows = await database
    .select({ eventRequestId: eventHandovers.eventRequestId })
    .from(eventHandovers)
    .innerJoin(eventRequests, eq(eventRequests.id, eventHandovers.eventRequestId))
    .where(
      and(
        isNull(eventHandovers.decision),
        eq(eventHandovers.toCoordinatorId, userId),
        inArray(eventHandovers.eventRequestId, [...eventIds]),
        eq(eventRequests.assignedCoordinatorId, eventHandovers.fromCoordinatorId),
        notInArray(eventRequests.status, ["approved", "rejected"])
      )
    );
  return rows.map(row => row.eventRequestId);
}
