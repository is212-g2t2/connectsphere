import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

/** One label-over-control pair, mirroring the form's `Field` rows. */
function FieldSkeleton({ multiline = false }: { multiline?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-40" />
      <Skeleton className={multiline ? "h-24 w-full" : "h-9 w-full"} />
    </div>
  );
}

/** One separated group, mirroring the form's `FieldSet` sections. */
function FieldSetSkeleton() {
  return (
    <div className="space-y-6 border-t border-border pt-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldSkeleton />
        <FieldSkeleton />
      </div>
    </div>
  );
}

/**
 * The new/edit event request form's loading shape: back link, heading and the form's field
 * groups. `reopenDraft/$id` waits on the draft it seeds the form with, so the skeleton draws the
 * form the arriving organiser will fill rather than the record.
 */
export function EventRequestsPageSkeleton() {
  return (
    <Page width="page" aria-busy="true">
      <output className="sr-only">Loading this event request…</output>

      <Skeleton className="h-4 w-44" />
      <Skeleton className="mt-6 h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <div className="mt-10 space-y-6">
        <Skeleton className="h-4 w-full max-w-2xl" />
        <FieldSkeleton />
        <FieldSkeleton multiline />
        <FieldSetSkeleton />
        <FieldSetSkeleton />
        <div className="flex flex-wrap gap-3 border-t border-border pt-6">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>
    </Page>
  );
}
