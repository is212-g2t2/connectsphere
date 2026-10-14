import { Badge } from "#/components/ui/badge";
import { VENUE_REQUEST_CONFLICT_LABELS } from "#/features/venue-requests/schema";
import type { VenueRequestConflict } from "#/features/venue-requests/schema";

/**
 * PTR-36, PTR-138 AC1: Flag a pending request that approval would refuse now: it overlaps an
 * approved booking or an active hold, or the venue is closed or blocked for its window. The badge
 * uses the `stopped` pill. Every page draws it the same way.
 */
export function ConflictBadge({ conflict }: { conflict: VenueRequestConflict }) {
  return <Badge variant="stopped">{VENUE_REQUEST_CONFLICT_LABELS[conflict]}</Badge>;
}
