import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const ROWS = [0, 1, 2];

/** The loading shape of Technical Support's work list: back link, page heading, then table rows. */
export function EquipmentRequestSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading equipment requests…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <div className="mt-8 divide-y divide-border">
        {ROWS.map(row => (
          <div key={row} className="flex items-center gap-4 py-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Page>
  );
}

/** The loading shape of one request's review page: back link, heading, date line, stacked line cards. */
export function EquipmentReviewSkeleton() {
  return (
    <Page width="page" aria-busy="true">
      <output className="sr-only">Loading equipment request…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-48" />

      <div className="mt-8 space-y-4">
        {ROWS.map(row => (
          <div key={row} className="space-y-3 rounded-lg border border-border p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </Page>
  );
}
