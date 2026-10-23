import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const ROWS = [0, 1, 2];

/**
 * The dashboard's loading shape: the header and the row list, so the loader that reads the
 * caller's events and queue shows the page it is about to become rather than a blank screen.
 */
export function DashboardPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading your dashboard…</output>

      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-96" />
      <Skeleton className="mt-4 h-9 w-44" />

      <ul className="mt-8 space-y-4" aria-hidden="true">
        {ROWS.map(row => (
          <li key={row} className="flex items-start gap-4">
            <Skeleton className="h-14 w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </div>
            <Skeleton className="h-6 w-24 shrink-0" />
          </li>
        ))}
      </ul>
    </Page>
  );
}
