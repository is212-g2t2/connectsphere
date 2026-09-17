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
    <main className="mx-auto max-w-4xl px-6 py-16" aria-busy="true">
      <output className="sr-only">Loading your dashboard…</output>

      <section className="flex flex-col">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="mt-3 h-9 w-72 md:h-10" />
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
        <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />

        <dl className="mt-10 grid gap-6 border-y border-border py-6 sm:grid-cols-3">
          {SESSION_FIELDS.map(field => (
            <div key={field}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-28" />
            </div>
          ))}
        </dl>

        <section className="mt-12 border-t border-border pt-8">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-2 h-7 w-64" />
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {EVENT_CARDS.map(card => (
              <div key={card} className="rounded-xl bg-card p-6 shadow-xs ring-1 ring-border">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-3 h-6 w-3/4" />
                <Skeleton className="mt-5 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-2/3" />
                <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 border-t border-border pt-6">
          <Skeleton className="h-4 w-32" />
        </div>
      </section>
    </main>
  );
}
