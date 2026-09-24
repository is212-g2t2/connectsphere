import { Card, CardContent } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import type { PendingBookingRequestDetail } from "#/features/venue-requests/server-fns";

const NONE_SPECIFIED = "None specified";

/** A read-only view of the current pending booking-request data supplied by the server reader. */
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
            <Detail term="Expected attendance">
              {orNoneSpecified(request.requirements.expectedAttendance)}
            </Detail>
            <Detail term="Layout">{orNoneSpecified(request.requirements.layout)}</Detail>
            <Detail term="Accessibility">
              {orNoneSpecified(request.requirements.accessibility)}
            </Detail>
            <Detail term="Required facilities" wide>
              {orNoneSpecified(request.requirements.requiredFacilities)}
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

function orNoneSpecified(value: string | number | null): string {
  if (typeof value === "number") return String(value);
  return value?.trim() ? value : NONE_SPECIFIED;
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
