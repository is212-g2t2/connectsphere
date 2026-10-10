import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

/**
 * The universal event page's loading shape for every access: the back link, the eyebrow, the
 * status pill, the title, the record stack, and the sticky action rail. Nothing role-gated is
 * promised (the `DashboardPageSkeleton` rule).
 */
export function EventDetailPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading this event…</output>

      <Skeleton className="h-4 w-32" />

      <div className="mt-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-5 w-24 rounded-full" />
        <Skeleton className="mt-3 h-10 w-2/3" />
        <Skeleton className="mt-4 h-4 w-1/2" />
      </div>

      <div className="mt-6">
        <div className="grid items-start gap-8 split:grid-cols-[1.6fr_1fr]">
          <div className="min-w-0">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-8 h-40 w-full" />
          </div>
          <div className="min-w-0">
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    </Page>
  );
}
