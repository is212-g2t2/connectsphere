/**
 * Share hold-ownership checks between the calendar projection and the hold writers.
 * Keep this module client-safe: no `#/db` and no server-only imports, so routes may import it.
 */

export interface HoldOwnership {
  heldById: string | null;
  assignedCoordinatorId: string | null;
}

/**
 * Allow release by the holder or the event's current assignee. Allow release by any signed-in viewer when
 * both owner references are gone. The hold is then orphaned and nobody else can free the slot.
 * Conversion reuses this check as the release half of its gate.
 */
export function canReleaseHold(hold: HoldOwnership, viewerId: string): boolean {
  if (viewerId === "") return false;
  if (hold.heldById === null && hold.assignedCoordinatorId === null) return true;
  return hold.heldById === viewerId || hold.assignedCoordinatorId === viewerId;
}

/** Allow conversion by the event's current assignee while the event is still `submitted`. */
export function canConvertHold(
  hold: HoldOwnership & { eventStatus: string },
  viewerId: string
): boolean {
  return (
    viewerId !== "" && hold.assignedCoordinatorId === viewerId && hold.eventStatus === "submitted"
  );
}
