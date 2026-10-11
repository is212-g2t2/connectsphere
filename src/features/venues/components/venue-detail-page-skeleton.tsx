import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

/** Show one label-over-value pair of the record grid. Span long lists across both columns. */
function DetailSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-2 h-4 w-full" />
    </div>
  );
}

/**
 * Show the venue detail loading shape: back link, name, description, and the record field grid.
 * The edit form, read-only record, and PTR-31 request panel are role-gated. Draw the neutral grid.
 * The skeleton must not promise controls the arriving user may lack (the rule
 * `VenueListPageSkeleton` states).
 */
export function VenueDetailPageSkeleton() {
  return (
    <Page width="page" aria-busy="true">
      <output className="sr-only">Loading this venue…</output>

      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-6 h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <dl className="mt-8 grid gap-6 sm:grid-cols-2">
        <DetailSkeleton />
        <DetailSkeleton />
        <DetailSkeleton />
        <DetailSkeleton />
        <DetailSkeleton />
        {/* Operating hours: the one field the read-only record and the form both span wide. */}
        <DetailSkeleton wide />
      </dl>
    </Page>
  );
}
