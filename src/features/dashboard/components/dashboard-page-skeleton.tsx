import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

const EVENT_CARDS = [0, 1];

/**
 * The dashboard's loading shape: the header and the card grid, so the loader that reads the
 * caller's events shows the page it is about to become rather than a blank screen.
 */
export function DashboardPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading your dashboard…</output>

      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-3 h-8 w-72" />

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {EVENT_CARDS.map(card => (
          <Card key={card}>
            <CardContent>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-5 w-3/4" />
              <Skeleton className="mt-5 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}
