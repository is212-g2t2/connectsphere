import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

/** One label-over-value pair of the record grid; the long event-timing row spans both columns. */
function DetailSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-2 h-4 w-full" />
    </div>
  );
}

/**
 * The booking-request detail's loading shape: back link, title, the read-only record grid and the
 * shared requirements treatment, mirroring `BookingRequestDetailsPage`.
 */
export function BookingRequestDetailsSkeleton() {
  return (
    <Page width="page" aria-busy="true">
      <output className="sr-only">Loading this booking request…</output>

      <Skeleton className="h-4 w-44" />
      <Skeleton className="mt-6 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <section className="mt-8">
        <Skeleton className="h-8 w-56" />
        <Card className="mt-4">
          <CardContent>
            <dl className="grid gap-6 sm:grid-cols-2">
              <DetailSkeleton />
              <DetailSkeleton />
              <DetailSkeleton />
              <DetailSkeleton />
              <DetailSkeleton wide />
            </dl>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <DetailSkeleton />
              <DetailSkeleton />
              <DetailSkeleton />
              <DetailSkeleton />
            </div>
          </CardContent>
        </Card>
      </section>
    </Page>
  );
}
