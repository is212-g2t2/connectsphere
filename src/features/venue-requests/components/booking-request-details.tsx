import { Card, CardContent } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import {
  formatInstant,
  formatLocalDateTime,
  formatProposedWindow,
} from "#/features/event-requests/format";
import { EventRequirements } from "#/features/events/components/event-requirements";
import { VenueStateBadge } from "#/features/venue-requests/components/venue-state-badge";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

/**
 * Show the current booking request as read-only server data.
 * Use the shared `EventRequirements` treatment for all four operational fields. It hides blank
 * fields instead of showing "None specified". Map the server's `accessibility` field to the
 * shared `accessibilityRequirements` field.
 */
export function BookingRequestDetails({ request }: { request: PendingVenueRequestDetail }) {
  // Key the heading id by request: the staff page renders one detail block per pending request.
  // Name it with the venue and window: several blocks share the section, so each needs its own name.
  const headingId = `booking-request-details-heading-${request.id}`;
  const window = formatProposedWindow({ start: request.startsAt, end: request.endsAt });
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="display-h3">
        Booking request details: {request.venueName}, {window}
      </h2>

      {request.conflict ? (
        <Badge className="mt-4" variant="progress">
          {request.conflict === "hold" ? "Conflicting hold" : "Conflicting booking"}
        </Badge>
      ) : null}

      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Status">
              <VenueStateBadge status="pending" />
            </Detail>
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
