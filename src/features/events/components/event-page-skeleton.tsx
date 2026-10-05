import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

/**
 * The attendee event page's loading shape: the two-column shell — cover square beside the
 * status pill, title, date and venue rows, the registration card and About Event — so a
 * navigation from the dashboard shows the page it is about to become. Every block here is the
 * published view, so nothing role-gated is promised (the `DashboardPageSkeleton` rule).
 */
export function EventPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading this event…</output>

      <Skeleton className="h-4 w-32" />

      <div className="mt-6 grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-12">
        <div className="aspect-square w-full overflow-hidden rounded-2xl">
          <Skeleton className="size-full" />
        </div>

        <div className="min-w-0">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="mt-3 h-12 w-3/4" />

          <div className="mt-6 flex items-start gap-3">
            <Skeleton className="size-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/3" />
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3">
            <Skeleton className="size-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-4 w-1/3" />
            </div>
          </div>

          <Card className="mt-6">
            <CardContent>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </CardContent>
          </Card>

          <div className="mt-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-full max-w-prose" />
          </div>
        </div>
      </div>
    </Page>
  );
}
