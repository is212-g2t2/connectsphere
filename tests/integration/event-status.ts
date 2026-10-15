import type * as schema from "#/db/schema";

type EventStatus = (typeof schema.eventRequestStatus.enumValues)[number];

const DECIDED: ReadonlySet<EventStatus> = new Set<EventStatus>([
  "approved",
  "rejected",
  "planning",
  "confirmed",
  "completed",
]);

/**
 * PTR-138: the statuses in which an event accepts venue requests, holds and hold conversion
 * (`SEARCHABLE_EVENT_STATUSES`). The tests list them here, so a change to the gate fails them.
 */
export const ACCEPTING_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_organiser",
  "approved",
  "planning",
] as const satisfies readonly EventStatus[];

/** The statuses that the gate refuses. A cancelled event gets its own message (PTR-54 AC9). */
export const REFUSED_STATUSES = [
  "draft",
  "rejected",
  "confirmed",
  "completed",
] as const satisfies readonly EventStatus[];

/**
 * Return the `event_requests` columns that move an existing event to `status` and satisfy every
 * status CHECK constraint. `actor` signs each decision, confirmation, completion and cancellation.
 * A draft has no Coordinator, so a draft also clears the assignment.
 */
export function eventStatusColumns(status: EventStatus, actor: { id: string; name: string }) {
  const decided = DECIDED.has(status);
  const confirmed = status === "confirmed" || status === "completed";
  const completed = status === "completed";
  const cancelled = status === "cancelled";
  return {
    status,
    submittedAt: status === "draft" ? null : new Date(),
    ...(status === "draft" ? { assignedCoordinatorId: null } : {}),
    decisionReason: status === "rejected" ? "Not suitable" : null,
    decidedByCoordinatorId: decided ? actor.id : null,
    decidedByCoordinatorName: decided ? actor.name : null,
    decidedAt: decided ? new Date() : null,
    confirmedById: confirmed ? actor.id : null,
    confirmedByName: confirmed ? actor.name : null,
    confirmedAt: confirmed ? new Date() : null,
    completedById: completed ? actor.id : null,
    completedByName: completed ? actor.name : null,
    completedAt: completed ? new Date() : null,
    cancelledById: cancelled ? actor.id : null,
    cancelledByName: cancelled ? actor.name : null,
    cancelledAt: cancelled ? new Date() : null,
  };
}
