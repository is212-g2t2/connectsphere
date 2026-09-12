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
  venue: ["create", "update", "read"],
} as const;

const ac = createAccessControl(statement);

/**
 * ponytail: the matrix covers only the functions that exist today. The equipment and
 * coordination rows arrive with the stories that build them (PTR-8, PTR-38 and the rest).
 *
 * `venue` (PTR-26) is the first internal/external split: Venue Staff maintain the catalogue,
 * the other two internal roles read it, and the external roles hold nothing — PTR-28
 * criterion 5 refuses them the calendar, so they are refused the record beneath it too.
 */
const ROLE_PERMISSIONS: Record<Role, ReturnType<typeof ac.newRole>> = {
  // Uploads attach documents to a request or a venue, so attendees hold no functions yet:
  // an empty role authorizes nothing, which is the fail-closed default we want.
  attendee: ac.newRole({}),
  event_organiser: ac.newRole({ upload: ["create"] }),
  event_coordinator: ac.newRole({ upload: ["create"], venue: ["read"] }),
  venue_staff: ac.newRole({ upload: ["create"], venue: ["create", "update", "read"] }),
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
