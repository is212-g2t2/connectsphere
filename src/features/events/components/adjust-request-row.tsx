import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { buttonVariants } from "#/components/ui/button";
import type { VenueRequestRejection } from "#/features/events/access";

/**
 * Prefill an adjusted request: the suggested venue when Venue Staff named one, else the refusing
 * venue. Fall each window part back the same way. A "same room, a day later" suggestion then
 * needs nothing retyped. Take times only as a pair.
 */
export function adjustedRequest(rejection: VenueRequestRejection): {
  venueId: number;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
} {
  const suggestion = rejection.suggestion;
  const times =
    suggestion?.startTime && suggestion.endTime
      ? { startTime: suggestion.startTime, endTime: suggestion.endTime }
      : { startTime: rejection.startTime, endTime: rejection.endTime };
  return {
    venueId: rejection.suggestedVenueId ?? rejection.venueId,
    venueName: suggestion?.venueName ?? rejection.venueName,
    date: suggestion?.date ?? rejection.date,
    ...times,
  };
}

/**
 * Reopen the request on the suggested venue with its window. Show this action only while the
 * event stands in `SEARCHABLE_EVENT_STATUSES`. That is the set the venue page's request panel
 * answers. Show it only to the Coordinator, and only on an entry the projection marks
 * `adjustable`. The caller applies the status, role, and `adjustable` gates.
 */
export function AdjustRequestRow({
  eventId,
  rejection,
}: {
  eventId: number;
  rejection: VenueRequestRejection;
}) {
  const { venueId, venueName, ...prefill } = adjustedRequest(rejection);
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-muted-foreground">Next step</dt>
      <dd className="mt-1 min-w-0 font-medium text-foreground">
        <Link
          to="/venues/$venueId"
          params={{ venueId: String(venueId) }}
          search={{ eventId, ...prefill }}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-auto min-w-0 whitespace-normal py-1.5 text-left"
          )}
        >
          Adjust request at {venueName}
        </Link>
      </dd>
    </div>
  );
}
