import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { formatInstant } from "#/features/event-requests/format";
import type { MarkNotificationsReadValues } from "#/features/notifications/schema";
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
 * PTR-56: an unread row carries an "Unread" label after its line and its own mark-read button, so
 * read state is told in text rather than by ink alone (ink already means "actionable"), and every
 * line keeps the same left edge. The header counts every unread row, not just the listed ones, as
 * a live status so the change after a mark is announced. "Mark all as read" sends the highest
 * listed id as its cutoff (see `handleMarkNotificationsRead`). Either action re-reads the list; a
 * failure is a toast, because a banner above a long list sits out of view of the row clicked.
 */
export function NotificationsPage({
  notifications,
  unreadCount,
}: {
  notifications: readonly NotificationListItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [, markRead, marking] = useMutation(async (input: MarkNotificationsReadValues) => {
    try {
      await markNotificationsRead({ data: input });
    } finally {
      // A refusal may follow a mark that landed (a lost response), so re-read either way rather
      // than leave rows showing a state the server no longer holds.
      await router.invalidate();
    }
  }, "Could not mark as read. Try again.");
  const handleMark = async (input: MarkNotificationsReadValues) => {
    const state = await markRead(input);
    if (state.status === "error") toast.error(state.error);
  };

  // Empty, the page already says there is nothing; a count line would only repeat it.
  const description = (
    <>
      {notifications.length > 0 && (
        <>
          <output className="font-medium text-foreground">
            {unreadCount === 0 ? "Nothing unread" : `${unreadCount} unread`}
          </output>
          .{" "}
        </>
      )}
      Everything addressed to you, newest first.
    </>
  );

  return (
    <Page width="page">
      <PageHeader
        eyebrow="Your account"
        title="Notifications"
        description={description}
        actions={
          // The count and the list share one snapshot, so a count above zero means rows are listed.
          unreadCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={marking}
              onClick={() =>
                void handleMark({ throughId: Math.max(...notifications.map(item => item.id)) })
              }
            >
              Mark all as read
            </Button>
          ) : null
        }
      />

      {notifications.length === 0 ? (
        <p className="body-sm text-muted-foreground">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {notifications.map(notification => {
            const when = formatInstant(new Date(notification.createdAt));
            return (
              <li
                key={notification.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4"
              >
                {notification.summary === null ? (
                  <p className="body-md text-muted-foreground">{NEUTRAL_LINE}</p>
                ) : notification.href === null ? (
                  <p className="body-md text-muted-foreground">{notification.summary}</p>
                ) : (
                  <a href={notification.href} className={NAV_LINK_CLASSNAME}>
                    {notification.summary}
                  </a>
                )}
                {!notification.read && <Badge>Unread</Badge>}
                {/* Reserves the mark button's height, so a row keeps its height once read. */}
                <span className="ml-auto flex min-h-8 items-center gap-3">
                  {!notification.read && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={marking}
                      aria-label={`Mark as read, ${notification.summary ?? NEUTRAL_LINE}, ${when}`}
                      onClick={() => void handleMark({ id: notification.id })}
                    >
                      Mark as read
                    </Button>
                  )}
                  <time className="body-sm text-muted-foreground" dateTime={notification.createdAt}>
                    {when}
                  </time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
