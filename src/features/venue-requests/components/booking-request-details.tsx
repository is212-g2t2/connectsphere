import { Card, CardContent } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import { EventRequirements } from "#/features/events/components/event-requirements";
import type { PendingBookingRequestDetail } from "#/features/venue-requests/server-fns";

/**
 * A read-only view of the current pending booking-request data supplied by the server reader.
 * The four operational requirement fields reuse the canonical `EventRequirements` treatment the
 * venue panel and event cards share, so a blank field drops out rather than reading "None
 * specified". The server names its accessibility field `accessibility`, so the call site maps it
 * onto the canonical `accessibilityRequirements`.
 */
export function BookingRequestDetails({ request }: { request: PendingBookingRequestDetail }) {
  return (
    <section aria-labelledby="booking-request-details-heading">
      <h2 id="booking-request-details-heading" className="display-h2">
        Booking request details
      </h2>

      {request.conflict ? (
        <Badge className="mt-4" variant="progress">
          Overlaps approved booking
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
