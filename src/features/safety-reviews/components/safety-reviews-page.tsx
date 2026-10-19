import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { formatInstant, formatVenuePeriod } from "#/features/event-requests/format";
import type { PendingSafetyReview } from "#/features/safety-reviews/schema";
import { SAFETY_REVIEW_WITHDRAWN_LABEL } from "#/features/safety-reviews/schema";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-146 AC2: the Safety Officer's shared review list. Every pending review on an approved or
 * planning event shows. A pending review whose arrangements changed since it was raised shows as
 * withdrawn, and a review on a cancelled, completed or rejected event does not show at all. Rows
 * arrive from the route's loader; opening one reads the event and its decision form.
 */
export function SafetyReviewsPage({ reviews }: { reviews: PendingSafetyReview[] }) {
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        title="Safety reviews"
        description="Events whose venue and technical arrangements are complete. Open an event to read its arrangements and record your decision."
      />

      {reviews.length === 0 ? (
        <p className="mt-10 body-sm text-muted-foreground">No events await a safety review.</p>
      ) : (
        <div className="mt-10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map(review => (
                <TableRow key={review.id}>
                  <TableCell>
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: String(review.eventId) }}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {review.eventName.trim() || UNTITLED_REQUEST}
                    </Link>
                    <div className="mt-1">
                      <EventRequestStatusBadge status={review.eventStatus} />
                    </div>
                  </TableCell>
                  <TableCell>{review.venueName ?? "No approved venue"}</TableCell>
                  <TableCell>
                    {review.startsAt !== null && review.endsAt !== null
                      ? formatVenuePeriod(review.startsAt, review.endsAt)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <time dateTime={review.createdAt}>
                      {formatInstant(new Date(review.createdAt))}
                    </time>
                  </TableCell>
                  <TableCell>
                    {review.current ? (
                      <Badge variant="progress">Awaiting decision</Badge>
                    ) : (
                      <Badge variant="stopped">{SAFETY_REVIEW_WITHDRAWN_LABEL}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Page>
  );
}
