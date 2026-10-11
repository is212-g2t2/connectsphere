import { Badge } from "#/components/ui/badge";
import {
  EVENT_REQUEST_STATUS_LABELS,
  EVENT_REQUEST_STATUS_VARIANTS,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";

/**
 * Show each event-request status with its plain-language label and design-system pill (PTR-21
 * criterion 2). Color and text distinguish drafts, requests under review, and rejected requests.
 */
export function EventRequestStatusBadge({ status }: { status: EventRequestStatus }) {
  const label = EVENT_REQUEST_STATUS_LABELS[status];
  // Beside a link, a bare "Planning" is ambiguous to a screen reader; the name says what it is.
  return (
    <Badge variant={EVENT_REQUEST_STATUS_VARIANTS[status]} aria-label={`Status: ${label}`}>
      {label}
    </Badge>
  );
}
