import { useRouter } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { formatInstant } from "#/features/event-requests/format";
import { markNotificationsRead } from "#/features/notifications/server-fns";
import type { NotificationListItem } from "#/features/notifications/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const NEUTRAL_LINE = "This notification is no longer available.";

/**
 * PTR-55: the notification list, newest first. The server sends a null summary for a row whose
 * subject the caller can no longer reach (AC5), so the neutral sentence here is all that renders —
 * no event name, no link. A null href with a summary is a row with something to say but nowhere
 * safe to send the reader (for example a settled venue request with no detail page). Both
 * non-actionable rows render muted so the linked row is the only full-ink element in the list.
 * Timestamps use the shared instant formatter, which pins the zone for SSR and hydration.
 *
 * PTR-56: an unread row carries an "Unread" label and its own mark-read button, so read state is
 * told in text rather than by ink alone; ink already means "actionable". The header counts every
 * unread row, not just the listed ones, and "Mark all as read" stops at the newest listed row, so
 * a notification raised after the page rendered stays unread. Either action re-reads the list.
 */
export function NotificationsPage({
  notifications,
  unreadCount,
}: {
  notifications: readonly NotificationListItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [marking, markRead, pending] = useMutation(
    async (input: { id: number } | { throughId: number }) => {
      try {
        await markNotificationsRead({ data: input });
      } finally {
        await router.invalidate();
      }
    },
    "Could not mark notifications as read. Try again."
  );

  return (
    <Page width="page">
      <PageHeader
        eyebrow="Your account"
        title="Notifications"
        description={`${unreadCount === 0 ? "Nothing unread" : `${unreadCount} unread`}. Everything addressed to you, newest first.`}
        actions={
          unreadCount > 0 && notifications.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void markRead({ throughId: notifications[0].id })}
            >
              Mark all as read
            </Button>
          ) : null
        }
      />

      {marking.status === "error" && (
        <p role="alert" className="mb-4 body-sm text-destructive">
          {marking.error}
        </p>
      )}

      {notifications.length === 0 ? (
        <p className="body-sm text-muted-foreground">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {notifications.map(notification => (
            <li
              key={notification.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4"
            >
              {!notification.read && <Badge variant="progress">Unread</Badge>}
              {notification.summary === null ? (
                <p className="body-md text-muted-foreground">{NEUTRAL_LINE}</p>
              ) : notification.href === null ? (
                <p className="body-md text-muted-foreground">{notification.summary}</p>
              ) : (
                <a href={notification.href} className={NAV_LINK_CLASSNAME}>
                  {notification.summary}
                </a>
              )}
              <span className="ml-auto flex items-baseline gap-3">
                {!notification.read && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    aria-label={`Mark as read: ${notification.summary ?? NEUTRAL_LINE}`}
                    onClick={() => void markRead({ id: notification.id })}
                  >
                    Mark as read
                  </Button>
                )}
                <time className="body-sm text-muted-foreground" dateTime={notification.createdAt}>
                  {formatInstant(new Date(notification.createdAt))}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
