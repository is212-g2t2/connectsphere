import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const NOTIFICATION_ROWS = [0, 1, 2];

/**
 * The notifications list's loading shape: the page heading and the list's rows, so the loader
 * behind `NotificationsPage` shows the page it is about to become.
 */
export function NotificationsPageSkeleton() {
  return (
    <Page width="page" aria-busy="true">
      <output className="sr-only">Loading your notifications…</output>

      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-3 h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />

      <div className="mt-8 divide-y divide-border">
        {NOTIFICATION_ROWS.map(row => (
          <div key={row} className="flex min-h-16 items-center gap-4 py-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </Page>
  );
}
