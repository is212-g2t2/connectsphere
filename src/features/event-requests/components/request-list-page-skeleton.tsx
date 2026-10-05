import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const REQUEST_ROWS = ["row-1", "row-2", "row-3"];

function RequestRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3">
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}

/**
 * The event request list's loading shape: back link, heading, and the table's five columns.
 */
export function EventRequestListPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading your event requests…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <div className="mt-10 divide-y divide-border">
        <div className="flex items-center gap-4 py-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        {REQUEST_ROWS.map(row => (
          <RequestRowSkeleton key={row} />
        ))}
      </div>
    </Page>
  );
}
