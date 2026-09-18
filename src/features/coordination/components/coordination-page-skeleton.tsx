import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const ASSIGNED_ROWS = [0, 1, 2];
const UNASSIGNED_ROWS = [0, 1, 2, 3];

/**
 * The coordination list's loading shape (PTR-16): back link, page heading and both assignment
 * sections, so a slow loader shows the page it is about to become rather than a blank screen.
 */
export function CoordinationPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading coordination requests…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-3/4 max-w-md" />

      <section className="mt-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
        <ul className="mt-4 divide-y divide-border">
          {ASSIGNED_ROWS.map(row => (
            <li key={row} className="py-3">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="mt-1 h-3.5 w-32" />
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 divide-y divide-border">
          <div className="flex items-center gap-4 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          {UNASSIGNED_ROWS.map(row => (
            <div key={row} className="flex items-center gap-4 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
