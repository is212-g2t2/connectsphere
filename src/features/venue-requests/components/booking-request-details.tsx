import { Card, CardContent } from "#/components/ui/card";
import {
  formatInstant,
  formatLocalDateTime,
  formatProposedWindow,
} from "#/features/event-requests/format";
import { EventRequirements } from "#/features/events/components/event-requirements";
import { ConflictBadge } from "#/features/venue-requests/components/conflict-badge";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";
import type { RoomLayout } from "#/features/venues/schema";

/**
 * Show one pending booking request as read-only server data.
 * Use the shared `EventRequirements` treatment for all four operational fields. It hides blank
 * fields instead of showing "None specified".
 */
export function BookingRequestDetails({
  request,
  layouts,
}: {
  request: PendingVenueRequestDetail;
  /** The maintained list, so a named layout shows by its label. Absent callers show the initials. */
  layouts?: readonly Pick<RoomLayout, "key" | "label">[];
}) {
  // Key the heading id by request: the staff page renders one detail block per pending request.
  // Name it with the venue and window: several blocks share the section, so each needs its own name.
  const headingId = `booking-request-details-heading-${request.id}`;
  const period = formatProposedWindow({ start: request.startsAt, end: request.endsAt });
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="display-h3">
        Booking request details: {request.venueName}, {period}
      </h2>

      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Status">
              <span className="flex flex-wrap items-center gap-2">
                <VenueRequestStatusBadge status="pending" />
                {request.conflict ? <ConflictBadge conflict={request.conflict} /> : null}
              </span>
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
          <EventRequirements event={request.requirements} layouts={layouts} className="mt-6" />
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
