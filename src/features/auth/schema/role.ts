import { z } from "zod";

/**
 * External roles a visitor may self-assign at registration (PTR-5).
 *
 * Shared by the sign-up form and the Better Auth `role` field validator so the client and the
 * server enforce the same set — the server copy is the load-bearing one, since the form can be
 * bypassed entirely by posting to `/api/auth/sign-up/email` or `/api/auth/update-user`.
 *
 * Internal roles (Event Coordinator, Venue Staff, Technical Support Staff) are deliberately
 * absent: they are assigned by staff, never chosen by the person registering.
 */
export const RoleSchema = z.enum(["attendee", "event_organiser"]);

export type Role = z.infer<typeof RoleSchema>;

export const DEFAULT_ROLE: Role = "attendee";
