import { Card, CardContent } from "#/components/ui/card";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import type { BookingRequestDetail } from "#/features/venue-requests/types";

const NONE_SPECIFIED = "None specified";

/** A read-only view of the stored booking-request snapshot supplied by a future adapter. */
export function BookingRequestDetails({ request }: { request: BookingRequestDetail }) {
  return (
    <section aria-labelledby="booking-request-details-heading">
      <h2 id="booking-request-details-heading" className="display-h2">
        Booking request details
      </h2>

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
            <Detail term="Expected attendance">{request.requirements.expectedAttendance}</Detail>
            <Detail term="Layout">{orNoneSpecified(request.requirements.layout)}</Detail>
            <Detail term="Accessibility">
              {orNoneSpecified(request.requirements.accessibility)}
            </Detail>
            <Detail term="Required facilities" wide>
              {request.requirements.requiredFacilities.join(", ") || NONE_SPECIFIED}
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

function orNoneSpecified(value: string | null): string {
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
