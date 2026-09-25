import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const QUEUE_ROWS = [0, 1, 2, 3];

/**
 * The pending queue's loading shape: back link, page heading, and the five-column table's rows,
 * so the loader behind `BookingRequestQueuePage` shows the page it is about to become.
 */
export function BookingRequestQueueSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading pending booking requests…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />

      <section className="mt-8">
        <div className="mt-4 divide-y divide-border">
          {QUEUE_ROWS.map(row => (
            <div key={row} className="flex items-center gap-4 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
