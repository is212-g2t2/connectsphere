import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { buttonVariants } from "#/components/ui/button";
import type { EventVenueRequest, VenueRequestRejection } from "#/features/events/access";

/**
 * Prefill an adjusted request from a rejected entry: the suggested venue when Venue Staff named
 * one, else the refusing venue. Fall each window part back the same way. A "same room, a day
 * later" suggestion then needs nothing retyped. Take times only as a pair. PTR-138 AC1: carry the
 * rejected session's requirements too. Leave out a null attendance, so the form uses the event's
 * figure.
 */
export function adjustedRequest(
  entry: EventVenueRequest,
  rejection: VenueRequestRejection
): {
  venueId: number;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  expectedAttendance?: number;
  layout?: string;
  accessibilityRequirements?: string;
  requiredFacilities?: string;
} {
  const suggestion = rejection.suggestion;
  const times =
    suggestion?.startTime && suggestion.endTime
      ? { startTime: suggestion.startTime, endTime: suggestion.endTime }
      : { startTime: entry.startTime, endTime: entry.endTime };
  const requirements = entry.requirements;
  const session = requirements
    ? {
        ...(requirements.expectedAttendance === null
          ? {}
          : { expectedAttendance: requirements.expectedAttendance }),
        layout: requirements.layout,
        accessibilityRequirements: requirements.accessibilityRequirements,
        requiredFacilities: requirements.requiredFacilities,
      }
    : {};
  return {
    venueId: rejection.suggestedVenueId ?? rejection.venueId,
    venueName: suggestion?.venueName ?? entry.venueName,
    date: suggestion?.date ?? entry.date,
    ...times,
    ...session,
  };
}

/**
 * Reopen the request on the suggested venue with its window and session requirements. Show this
 * action only while the event stands in `SEARCHABLE_EVENT_STATUSES`. That is the set the venue
 * page's request panel answers. Show it only to the Coordinator, and only on an entry the
 * projection marks `adjustable`. The caller applies the status, role, and `adjustable` gates.
 */
export function AdjustRequestRow({
  eventId,
  entry,
  rejection,
}: {
  eventId: number;
  entry: EventVenueRequest;
  rejection: VenueRequestRejection;
}) {
  const { venueId, venueName, ...prefill } = adjustedRequest(entry, rejection);
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
