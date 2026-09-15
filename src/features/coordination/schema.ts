import { z } from "zod";

const AssignmentInput = z.object({
  id: z.number().int().positive("Choose an event request"),
  coordinatorId: z.string().trim().min(1, "Choose an Event Coordinator"),
  // Required even for a pickup: a stale unassigned page must not overwrite another pickup.
  expectedCoordinatorId: z.string().min(1).nullable(),
});

export type AssignmentValues = z.infer<typeof AssignmentInput>;

export function parseAssignmentInput(input: unknown): AssignmentValues {
  const parsed = AssignmentInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
