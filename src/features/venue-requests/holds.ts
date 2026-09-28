/**
 * Pure hold-ownership predicates, shared by the calendar projection and the hold writers.
 * Client-safe on purpose: no `#/db`, no server-only imports, so routes may import this.
 */

export interface HoldOwnership {
  heldById: string | null;
  assignedCoordinatorId: string | null;
}

/**
 * Who may release: the holder, the event's current assignee, or anyone when both owner
 * references are gone (an orphaned hold has nobody left to free the slot).
 * Conversion callers reuse this as the release half of their gate.
 */
export function canReleaseHold(hold: HoldOwnership, viewerId: string): boolean {
  if (viewerId === "") return false;
  if (hold.heldById === null && hold.assignedCoordinatorId === null) return true;
  return hold.heldById === viewerId || hold.assignedCoordinatorId === viewerId;
}

/** Who may convert: the event's current assignee, while the event is still `submitted`. */
export function canConvertHold(
  hold: HoldOwnership & { eventStatus: string },
  viewerId: string
): boolean {
  return (
    viewerId !== "" && hold.assignedCoordinatorId === viewerId && hold.eventStatus === "submitted"
  );
}
