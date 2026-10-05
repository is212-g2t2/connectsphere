import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
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
 * The event request detail's loading shape: back link, title with its status pill, the submitted
 * summary, and the recorded field grid. The change request form, history, decision and
 * clarifications are all status-gated, so the skeleton draws the neutral record rather than
 * promising sections the arriving request may not have (the rule `VenueDetailPageSkeleton`
 * states).
 */
export function EventRequestDetailPageSkeleton() {
  return (
    <Page width="page" aria-busy="true">
      <output className="sr-only">Loading this event request…</output>

      <Skeleton className="h-4 w-44" />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />

      <Card className="mt-8">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <DetailSkeleton />
            <DetailSkeleton />
            <DetailSkeleton wide />
            <DetailSkeleton wide />
            <DetailSkeleton />
            <DetailSkeleton />
            <DetailSkeleton wide />
            <DetailSkeleton wide />
            <DetailSkeleton wide />
            <DetailSkeleton wide />
            <DetailSkeleton wide />
            <DetailSkeleton wide />
          </dl>
        </CardContent>
      </Card>
    </Page>
  );
}
