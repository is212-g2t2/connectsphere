import { Badge } from "#/components/ui/badge";
import {
  VENUE_REQUEST_STATUS_LABELS,
  VENUE_REQUEST_STATUS_VARIANTS,
} from "#/features/venue-requests/schema";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";

/**
 * PTR-138: Show each venue-request state with its plain-language label and status pill. The
 * Coordinator's event page, the Venue Staff card, and the Venue Staff decision page share it, so
 * one state always reads the same way.
 */
export function VenueRequestStatusBadge({ status }: { status: VenueRequestStatus }) {
  return (
    <Badge variant={VENUE_REQUEST_STATUS_VARIANTS[status]}>
      {VENUE_REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}
