import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const ROWS = [0, 1, 2];

/**
 * The loading shape shared by Technical Support's work list and its request detail: back link,
 * page heading, then a few rows for the events or the equipment lines about to arrive.
 */
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
