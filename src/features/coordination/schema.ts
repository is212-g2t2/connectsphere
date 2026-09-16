import { z } from "zod";

import { EVENT_REQUEST_ID_MESSAGE } from "#/features/event-requests/schema";

const AssignmentInput = z.object({
  // `event_requests.id` is int4: a larger id passes plain `int()` and reaches the `where` clause,
  // where Postgres raises 22003 instead of the intended refusal.
  id: z.int32({ error: EVENT_REQUEST_ID_MESSAGE }).positive(EVENT_REQUEST_ID_MESSAGE),
  coordinatorId: z.string().trim().min(1, "Choose an Event Coordinator"),
  // Required even for a pickup: a stale unassigned page must not overwrite another pickup.
  expectedCoordinatorId: z.string().min(1).nullable(),
});

export type AssignmentValues = z.infer<typeof AssignmentInput>;

/**
 * The coordinator choice on its own, derived from the rule above so the form and the server
 * function cannot drift on the message or the trim.
 */
export const CoordinatorSelection = AssignmentInput.pick({ coordinatorId: true });

export function parseAssignmentInput(input: unknown): AssignmentValues {
  const parsed = AssignmentInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
