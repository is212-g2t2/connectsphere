import { Badge } from "#/components/ui/badge";

/**
 * PTR-138: the one status pill for a venue request or booking. The Coordinator's event page and
 * the Venue Staff decision page share it, so one state always reads the same way. Name every
 * state; never fall through to Pending.
 */
export function VenueStateBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Badge variant="progress">Pending</Badge>;
    case "approved":
      return <Badge variant="confirmed">Approved</Badge>;
    case "rejected":
      return <Badge variant="stopped">Rejected</Badge>;
    case "released":
      return <Badge variant="stopped">Released</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
