import { createAccessControl } from "better-auth/plugins/access";
import type { RoleAuthorizeRequest } from "better-auth/plugins/access";

import { RoleSchema } from "#/features/auth/schema/role";
import type { Role } from "#/features/auth/schema/role";

/**
 * The role/function matrix (PTR-7). Rationale and the human-readable table live in
 * `docs/ARCHITECTURE.md#authorisation`.
 *
 * `createAccessControl` is a plain helper, *not* a plugin: it never goes in
 * `betterAuth({ plugins })`, and adding it there is the mistake to avoid.
 *
 * Pure data on purpose — the browser imports this too, and per AGENTS.md a server import here
 * would reach the client bundle and fail `bun run build` alone.
 */
const statement = {
  upload: ["create"],
  event_request: ["create", "coordinate"],
  venue: ["create", "update", "read", "search"],
  venue_request: ["request", "decide"],
} as const;

const ac = createAccessControl(statement);

/**
 * ponytail: the matrix covers only the functions that exist today. The equipment rows arrive
 * with the stories that build them (PTR-8, PTR-38 and the rest).
 *
 * `event_request:coordinate` (PTR-15) is what an Event Coordinator holds over submitted
 * requests: reading and assigning accessible requests (PTR-16), with review actions arriving
 * in PTR-17. It is deliberately not `create`: a Coordinator never authors
 * a request, and an Organiser never coordinates one.
 *
 * `venue` (PTR-26) is the first internal/external split: Venue Staff maintain the catalogue,
 * the other two internal roles read it, and the external roles hold nothing — PTR-28
 * criterion 5 refuses them the calendar, so they are refused the record beneath it too.
 *
 * `venue_request:request` (PTR-31) is what a Coordinator raises and withdraws a booking request
 * with; the handler re-reads the event's assignment, so the function says "may ask", not "may ask
 * for any event". `venue_request:decide` (PTR-36) is the Venue Staff verb that approves one; the
 * handler re-reads the shared-queue rule, so it says "may settle", not "may settle any row".
 */
const ROLE_PERMISSIONS: Record<Role, ReturnType<typeof ac.newRole>> = {
  // Uploads attach documents to a request or a venue, so attendees hold no functions yet:
  // an empty role authorizes nothing, which is the fail-closed default we want.
  attendee: ac.newRole({}),
  event_organiser: ac.newRole({ upload: ["create"], event_request: ["create"] }),
  event_coordinator: ac.newRole({
    upload: ["create"],
    event_request: ["coordinate"],
    venue: ["read", "search"],
    venue_request: ["request"],
  }),
  venue_staff: ac.newRole({
    upload: ["create"],
    venue: ["create", "update", "read"],
    venue_request: ["decide"],
  }),
  technical_support_staff: ac.newRole({ upload: ["create"], venue: ["read"] }),
};

export type PermissionRequest = RoleAuthorizeRequest<typeof statement>;

/**
 * Whether `role` permits every action in `request`.
 *
 * Parsing rather than asserting the role is what makes this fail closed: an unknown string, a
 * missing role, and the comma-joined pair Better Auth's `admin` plugin would have read as two
 * roles at once all resolve to no permissions at all.
 */
export function can(role: string | null | undefined, request: PermissionRequest): boolean {
  const parsed = RoleSchema.safeParse(role);
  return parsed.success && ROLE_PERMISSIONS[parsed.data].authorize(request).success;
}
