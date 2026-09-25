import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import type { PendingBookingRequest } from "#/features/venue-requests/server-fns";

/**
 * A presentational pending queue. Its caller owns the pending filter, oldest-first ordering, and
 * access checks; this component only renders the supplied records and links each to its detail
 * page.
 */
export function BookingRequestQueue({
  pendingRequestsOldestFirst,
}: {
  pendingRequestsOldestFirst: readonly PendingBookingRequest[];
}) {
  return (
    <section aria-labelledby="pending-booking-requests-heading">
      <h2 id="pending-booking-requests-heading" className="display-h2">
        Pending booking requests
      </h2>

      {pendingRequestsOldestFirst.length === 0 ? (
        <p className="mt-4 body-sm text-muted-foreground">No pending booking requests.</p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Starts at</TableHead>
                <TableHead>Ends at</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Open request</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingRequestsOldestFirst.map(request => (
                <TableRow key={request.id}>
                  <TableCell>{request.venueName}</TableCell>
                  <TableCell>{formatLocalDateTime(request.startsAt)}</TableCell>
                  <TableCell>{formatLocalDateTime(request.endsAt)}</TableCell>
                  <TableCell>
                    <time dateTime={request.submittedAt.toISOString()}>
                      {formatInstant(request.submittedAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    {request.conflict ? (
                      <Badge variant="progress">Overlaps approved booking</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/venue-requests/$requestId"
                      params={{ requestId: request.id }}
                      aria-label={`Open request for ${request.venueName}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
