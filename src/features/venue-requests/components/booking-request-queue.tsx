import { Link } from "@tanstack/react-router";
import type { ComponentType } from "react";

import { Badge } from "#/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * A presentational pending queue. Its caller owns the pending filter, access checks, and the
 * ordering: `requests` arrives oldest-first. This component only renders the supplied records and
 * links each to its detail page; `RowAction` is the caller's per-row control (PTR-33's approval),
 * and without it the table has no action column.
 */
export function BookingRequestQueue({
  requests,
  RowAction,
}: {
  requests: readonly PendingVenueRequest[];
  RowAction?: ComponentType<{ request: PendingVenueRequest }>;
}) {
  return (
    <section aria-labelledby="pending-booking-requests-heading">
      {/* The page h1 already names the queue; this keeps the section's accessible name without
          repeating that heading visually. */}
      <h2 id="pending-booking-requests-heading" className="sr-only">
        Pending booking requests
      </h2>

      {requests.length === 0 ? (
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
                {RowAction && <TableHead>Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(request => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Link
                      to="/venue-requests/$requestId"
                      params={{ requestId: request.id }}
                      aria-label={`Open request for ${request.venueName}, ${formatLocalDateTime(request.startsAt)}`}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {request.venueName}
                    </Link>
                  </TableCell>
                  <TableCell>{formatLocalDateTime(request.startsAt)}</TableCell>
                  <TableCell>{formatLocalDateTime(request.endsAt)}</TableCell>
                  <TableCell>
                    <time dateTime={request.submittedAt.toISOString()}>
                      {formatInstant(request.submittedAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    {request.conflict ? (
                      <Badge variant="progress">Conflicting booking</Badge>
                    ) : (
                      "No conflict"
                    )}
                  </TableCell>
                  {RowAction && (
                    <TableCell>
                      <RowAction request={request} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
