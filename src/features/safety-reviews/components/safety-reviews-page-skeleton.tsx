import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const ROWS = [0, 1, 2, 3];

/** PTR-146: the safety review list's loading shape. */
export function SafetyReviewsPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading safety reviews…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-52" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <div className="mt-10 divide-y divide-border">
        <div className="flex items-center gap-4 py-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-20" />
        </div>
        {ROWS.map(row => (
          <div key={row} className="flex items-center gap-4 py-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Page>
  );
}
