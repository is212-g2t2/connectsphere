import { Button } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatInstant, formatLocalDateTime } from "#/features/event-requests/format";
import type { BookingRequestSummary } from "#/features/venue-requests/types";

/**
 * A presentational pending queue. Its caller owns the pending filter, oldest-first ordering, and
 * access checks; this component only renders the supplied records and reports a selected id.
 */
export function BookingRequestQueue({
  pendingRequestsOldestFirst,
  onOpenRequest,
}: {
  pendingRequestsOldestFirst: readonly BookingRequestSummary[];
  onOpenRequest: (id: string) => void;
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Open request ${request.id}`}
                      onClick={() => onOpenRequest(request.id)}
                    >
                      Open
                    </Button>
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
