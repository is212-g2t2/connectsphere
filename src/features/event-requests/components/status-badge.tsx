import { Badge } from "#/components/ui/badge";
import {
  EVENT_REQUEST_STATUS_LABELS,
  EVENT_REQUEST_STATUS_VARIANTS,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";

/**
 * The one way an event request's status is shown (PTR-21 criterion 2): the plain-language label
 * on the design system's pill for that stage, so a draft, a request under review and a rejected
 * one are told apart by colour as well as by word wherever they appear.
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
