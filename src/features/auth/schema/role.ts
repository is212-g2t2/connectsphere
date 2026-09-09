import { z } from "zod";

/**
 * Every role the system recognises (PTR-7).
 *
 * The `user.role` column stores one of these, and `#/features/auth/permissions` maps each to its
 * row of the role/function matrix. The column is plain `text` with no CHECK constraint, so what
 * actually keeps a session to a single role is `can()` parsing this schema and failing closed —
 * a stored `"attendee,event_coordinator"` would grant nothing rather than both.
 */
export const RoleSchema = z.enum([
  "attendee",
  "event_organiser",
  "event_coordinator",
  "venue_staff",
  "technical_support_staff",
]);

export type Role = z.infer<typeof RoleSchema>;

/**
 * The subset a visitor may self-assign at registration (PTR-5).
 *
 * Shared by the sign-up form and the Better Auth `role` field validator so the client and the
 * server enforce the same set — the server copy is the load-bearing one, since the form can be
 * bypassed entirely by posting to `/api/auth/sign-up/email`.
 *
 * The internal roles above are deliberately absent, and no mechanism assigns them yet: sign-up
 * refuses them and `/update-user` refuses the field outright, so today they are reachable only
 * by writing the column directly. Provisioning staff accounts is PTR-59.
 */
export const SelfAssignableRoleSchema = z.enum(["attendee", "event_organiser"]);

export const DEFAULT_ROLE: z.infer<typeof SelfAssignableRoleSchema> = "attendee";
