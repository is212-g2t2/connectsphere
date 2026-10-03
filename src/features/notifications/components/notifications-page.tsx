import { Page, PageHeader } from "#/components/layout/page";
import { formatInstant } from "#/features/event-requests/format";
import type { NotificationListItem } from "#/features/notifications/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-55: the notification list, newest first. The server sends a null summary for a row whose
 * subject the caller can no longer reach (AC5), so the neutral sentence here is all that renders —
 * no event name, no link. A null href with a summary is a row with something to say but nowhere
 * safe to send the reader (for example a settled venue request with no detail page). Both
 * non-actionable rows render muted so the linked row is the only full-ink element in the list.
 * Timestamps use the shared instant formatter, which pins the zone for SSR and hydration.
 */
export function NotificationsPage({
  notifications,
}: {
  notifications: readonly NotificationListItem[];
}) {
  return (
    <Page width="page">
      <PageHeader
        eyebrow="Your account"
        title="Notifications"
        description="Everything addressed to you, newest first."
      />

      {notifications.length === 0 ? (
        <p className="body-sm text-muted-foreground">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {notifications.map(notification => (
            <li
              key={notification.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4"
            >
              {notification.summary === null ? (
                <p className="body-md text-muted-foreground">
                  This notification is no longer available.
                </p>
              ) : notification.href === null ? (
                <p className="body-md text-muted-foreground">{notification.summary}</p>
              ) : (
                <a href={notification.href} className={NAV_LINK_CLASSNAME}>
                  {notification.summary}
                </a>
              )}
              <time
                className="body-sm ml-auto text-muted-foreground"
                dateTime={notification.createdAt}
              >
                {formatInstant(new Date(notification.createdAt))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
