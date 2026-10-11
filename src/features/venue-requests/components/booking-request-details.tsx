import { Card, CardContent } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import { EventRequirements } from "#/features/events/components/event-requirements";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

/**
 * Show the current booking request as read-only server data.
 * Use the shared `EventRequirements` treatment for all four operational fields. It hides blank
 * fields instead of showing "None specified". Map the server's `accessibility` field to the
 * shared `accessibilityRequirements` field.
 */
export function BookingRequestDetails({ request }: { request: PendingVenueRequestDetail }) {
  return (
    <section aria-labelledby="booking-request-details-heading">
      <h2 id="booking-request-details-heading" className="display-h2">
        Booking request details
      </h2>

      {request.conflict ? (
        <Badge className="mt-4" variant="progress">
          {request.conflict === "hold" ? "Conflicting hold" : "Conflicting booking"}
        </Badge>
      ) : null}

      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Venue">{request.venueName}</Detail>
            <Detail term="Submitted">
              <time dateTime={request.submittedAt.toISOString()}>
                {formatInstant(request.submittedAt)}
              </time>
            </Detail>
            <Detail term="Starts at">{formatLocalDateTime(request.startsAt)}</Detail>
            <Detail term="Ends at">{formatLocalDateTime(request.endsAt)}</Detail>
            <Detail term="Event timing" wide>
              {request.requirements.eventTiming}
            </Detail>
          </dl>
          <EventRequirements
            event={{
              ...request.requirements,
              accessibilityRequirements: request.requirements.accessibility,
            }}
            className="mt-6"
          />
        </CardContent>
      </Card>
    </section>
  );
}

function Detail({
  term,
  wide = false,
  children,
}: {
  term: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="eyebrow text-muted-foreground">{term}</dt>
      <dd className="mt-2 body-md font-medium whitespace-pre-line">{children}</dd>
    </div>
  );
}
