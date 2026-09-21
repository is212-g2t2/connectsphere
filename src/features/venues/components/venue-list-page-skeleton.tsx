import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const RESULT_ROWS = ["row-1", "row-2", "row-3"];

function ResultRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3">
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-28" />
    </div>
  );
}

/**
 * The venue list's loading shape: back link, heading, and the results table's five columns.
 *
 * The search card is deliberately not drawn because it is role-gated, and a pending state must
 * not promise controls the arriving user may not have (the rule `DashboardPageSkeleton` states).
 */
export function VenueListPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading venues…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-24" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-16" />
        </div>

        <div className="divide-y divide-border">
          <div className="flex items-center gap-4 py-3">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          {RESULT_ROWS.map(row => (
            <ResultRowSkeleton key={row} />
          ))}
        </div>
      </section>
    </Page>
  );
}
