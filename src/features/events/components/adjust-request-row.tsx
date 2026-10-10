import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { buttonVariants } from "#/components/ui/button";
import type { VenueRequestRejection } from "#/features/events/access";

/**
 * What an adjusted request opens with: the suggested venue when Venue Staff named one, else the
 * venue that refused, and each part of the window falling back the same way, so a suggestion of
 * "same room, a day later" needs nothing retyped. Times are taken only as a pair.
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
 * The rejection block's action: reopen the request on the suggested venue with its window. Only
 * while the event is still `submitted`, the one status the venue page's request panel answers
 * for, and only for the Coordinator — the caller gates both.
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
