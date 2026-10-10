import { useRouter } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { Detail } from "#/features/event-requests/components/request-message-blocks";
import type { EventVenueRequest } from "#/features/events/access";
import { formatLocalDate } from "#/features/event-requests/format";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { ApproveBookingButton } from "#/features/venue-requests/components/approve-booking-button";
import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import { RejectBookingForm } from "#/features/venue-requests/components/reject-booking-form";
import { formatVenueSuggestion } from "#/features/venue-requests/schema";

/**
 * The Venue Staff page: read the booking request, then record the decision. The decision block
 * shows only while the request still waits (`venueDecision` present) and the event is not
 * cancelled, where approval is always refused; the request details stay readable afterwards from
 * the projection's own `venueRequest`.
 */
export function venueRequestSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event" || data.event.access !== "venue_staff") return [];
  const venueDecision = data.venueDecision ?? null;
  const venueRequest = data.event.event.venueRequest ?? null;
  return [
    {
      id: "request",
      label: "Booking request details",
      visible: () => venueDecision !== null || venueRequest !== null,
      render: inner => <RequestBody data={inner} />,
    },
    {
      id: "decision",
      label: "Record a decision",
      visible: () => venueDecision !== null && data.event.event.status !== "cancelled",
      render: inner => <DecisionBody data={inner} />,
    },
  ];
}

/** The pending request as Venue Staff know it, else the settled outcome the projection keeps. */
function RequestBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const venueDecision = data.venueDecision ?? null;
  if (venueDecision) return <BookingRequestDetails request={venueDecision.request} />;
  const venueRequest = data.event.event.venueRequest ?? null;
  if (venueRequest) return <VenueRequestOutcome outcome={venueRequest} />;
  return null;
}

/**
 * The decision controls with the old page's copy. The old page gated them on the session user's
 * `venue_request:decide` verb; the section only has the loader data, so the loader's
 * `venueDecision` is the gate and the server middleware still refuses the verb itself.
 */
function DecisionBody({ data }: { data: EventPageData }) {
  const router = useRouter();
  if (data.kind !== "event") return null;
  const venueDecision = data.venueDecision ?? null;
  if (!venueDecision) return null;
  const refresh = () => router.invalidate();
  return (
    <div>
      <h2 className="display-h3">Record a decision</h2>
      <p className="mt-2 body-sm text-muted-foreground">
        Approving holds the venue for this exact period. Rejecting needs a reason, and you can
        suggest an alternative. Either way the requesting Coordinator is notified.
      </p>
      <div className="mt-4">
        <ApproveBookingButton request={venueDecision.request} onDecided={refresh} />
      </div>
      <div className="mt-6 border-t border-border pt-6">
        <h3 className="display-h3">Reject this request</h3>
        <div className="mt-4">
          <RejectBookingForm
            request={venueDecision.request}
            venues={venueDecision.venues}
            onDecided={refresh}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * What a settled request leaves behind: its status and venue, the rejection with its suggested
 * alternative, or the release record. Labels mirror the dashboard workspace's venue request
 * block, so the same rejection reads the same everywhere.
 *
 * The settled outcome's short banner sits above the detail rows the projection keeps.
 */
const OUTCOME_BANNERS: Record<string, string> = {
  approved: "Booking approved.",
  rejected: "Request declined.",
  released: "Booking released.",
};

function VenueRequestOutcome({ outcome }: { outcome: EventVenueRequest }) {
  const suggestion = outcome.rejection?.suggestion
    ? formatVenueSuggestion(outcome.rejection.suggestion, formatLocalDate)
    : "";
  const banner = OUTCOME_BANNERS[outcome.status] ?? null;
  return (
    <div>
      <h2 className="display-h3">Booking request details</h2>
      {banner ? <p className="mt-2 body-md font-medium">{banner}</p> : null}
      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Venue request">
              <Badge variant={outcome.status === "approved" ? "default" : "stopped"}>
                {outcome.status.charAt(0).toUpperCase() + outcome.status.slice(1)}
              </Badge>
            </Detail>
            {outcome.venueName ? <Detail term="Venue">{outcome.venueName}</Detail> : null}
            {outcome.rejection ? (
              <>
                <Detail term="Rejected booking" wide>
                  {`${outcome.rejection.venueName}, ${formatLocalDate(outcome.rejection.date)}, ${outcome.rejection.startTime}–${outcome.rejection.endTime}`}
                </Detail>
                <Detail term="Rejection reason" wide>
                  {outcome.rejection.reason}
                </Detail>
                {suggestion ? (
                  <Detail term="Suggested alternative" wide>
                    {suggestion}
                  </Detail>
                ) : null}
              </>
            ) : null}
            {outcome.release ? (
              <>
                <Detail term="Released booking" wide>
                  {`${outcome.release.venueName}, ${formatLocalDate(outcome.release.date)}, ${outcome.release.startTime}–${outcome.release.endTime}`}
                </Detail>
                <Detail term="Release reason" wide>
                  {outcome.release.reason}
                </Detail>
                {outcome.release.changedByName ? (
                  <Detail term="Released by">{outcome.release.changedByName}</Detail>
                ) : null}
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
