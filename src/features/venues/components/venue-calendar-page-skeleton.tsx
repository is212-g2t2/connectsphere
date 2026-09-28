import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";

const RESULT_ROWS = ["row-1", "row-2", "row-3"];
const CALENDAR_WEEKS = ["week-1", "week-2", "week-3", "week-4", "week-5"];
const WEEKDAY_TICKS = ["day-1", "day-2", "day-3", "day-4", "day-5", "day-6", "day-7"];

/** One period row of the schedule list: date chip, label and time range, status badge. */
function ResultRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-4">
      <Skeleton className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-56" />
      </div>
      <Skeleton className="h-5 w-28 rounded-full" />
    </div>
  );
}

/**
 * The venue calendar's loading shape: back link, heading, the filter form's venue select, date
 * inputs and submit button, the sidebar month grid with its legend, and three schedule rows.
 *
 * The filter form is drawn because every role reaching this page can use it. The hold buttons on
 * the schedule rows are role-gated, so the skeleton leaves them out rather than promise controls
 * the arriving user may not have (the rule `VenueListPageSkeleton` states).
 */
export function VenueCalendarPageSkeleton() {
  return (
    <Page
      width="wide"
      aria-busy="true"
      sidebar={
        <aside aria-label="Calendar view">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-28" />
            <div className="flex gap-2">
              <Skeleton className="size-6" />
              <Skeleton className="size-6" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {WEEKDAY_TICKS.map(day => (
              <Skeleton key={day} className="h-3 w-full" />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {CALENDAR_WEEKS.flatMap(week =>
              WEEKDAY_TICKS.map(day => <Skeleton key={`${week}:${day}`} className="h-8 w-full" />)
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </aside>
      }
    >
      <output className="sr-only">Loading venue availability…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-8 w-44" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <section className="mt-8">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="mt-2 h-9 w-full" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-9 w-full" />
          </div>
          <div>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-9 w-full" />
          </div>
        </div>
        <Skeleton className="mt-5 h-9 w-full sm:w-36" />
      </section>

      <section className="mt-8">
        <div className="border-b border-border pb-5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
        <div className="divide-y divide-border">
          {RESULT_ROWS.map(row => (
            <ResultRowSkeleton key={row} />
          ))}
        </div>
      </section>
    </Page>
  );
}
