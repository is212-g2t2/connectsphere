import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

/** One label-over-value pair of the record grid; the long lists span both columns. */
function DetailSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-2 h-4 w-full" />
    </div>
  );
}

/**
 * The venue detail's loading shape: back link, name and description, then the record's field
 * grid. The edit form, the read-only record and PTR-31's request panel are all role-gated, so
 * the skeleton draws the neutral grid rather than promising controls the arriving user may not
 * have (the rule `VenueListPageSkeleton` states).
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
