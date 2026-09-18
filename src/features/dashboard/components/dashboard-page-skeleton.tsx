import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

const SESSION_FIELDS = [0, 1, 2];
const EVENT_CARDS = [0, 1];

/**
 * The dashboard's loading shape: the greeting, the session summary, the connected-events widget
 * and the settings link, so the loader that reads the caller's events shows the page it is about
 * to become rather than a blank screen.
 *
 * The role-gated links and the upload card are deliberately not drawn: they vary by role, and a
 * pending state must not promise controls the arriving user may not have.
 */
export function DashboardPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading your dashboard…</output>

      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-3 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />

      <Card className="mt-8">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-3">
            {SESSION_FIELDS.map(field => (
              <div key={field}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-5 w-28" />
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <section className="mt-12 border-t border-border pt-8">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="mt-2 h-5 w-64" />
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
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
      </section>

      <div className="mt-12 border-t border-border pt-6">
        <Skeleton className="h-4 w-32" />
      </div>
    </Page>
  );
}
