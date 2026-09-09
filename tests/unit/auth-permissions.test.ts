import { describe, expect, it } from "vitest";

import { can } from "#/features/auth/permissions";
import { AuthorizationError, requirePermission } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { RoleSchema } from "#/features/auth/schema/role";
import type { Role } from "#/features/auth/schema/role";

/**
 * The role/function matrix of PTR-7, restated independently of `permissions.ts`.
 *
 * The duplication is deliberate: widening a role has to be written twice and can never be a
 * slip. `Record<Role, …>` covers completeness, so a new role fails `type:check` before it
 * reaches here.
 */
const EXPECTED: Record<Role, { note: boolean; upload: boolean }> = {
  attendee: { note: true, upload: false },
  event_organiser: { note: true, upload: true },
  event_coordinator: { note: true, upload: true },
  venue_staff: { note: true, upload: true },
  technical_support_staff: { note: true, upload: true },
};

describe("role/function matrix (PTR-7)", () => {
  it.each(RoleSchema.options)("grants %s exactly its row of the matrix", role => {
    expect(can(role, { note: ["create", "read", "delete"] })).toBe(EXPECTED[role].note);
    expect(can(role, { upload: ["create"] })).toBe(EXPECTED[role].upload);
  });

  describe("fails closed", () => {
    it.each<string | null | undefined>([null, undefined, "", "admin", "Attendee"])(
      "refuses the role %o",
      role => {
        expect(can(role, { note: ["read"] })).toBe(false);
      }
    );

    // Criterion 4. Better Auth's `admin` plugin reads such a string as two roles at once,
    // which is precisely why this project does not use it.
    it("refuses a comma-separated pair of roles", () => {
      expect(can("attendee,event_coordinator", { note: ["read"] })).toBe(false);
    });
  });
});

/**
 * PTR-7 criterion 2 asks for an *authorisation* error, not a generic failure. The status lives on
 * the thrown error so `server-fns.ts` can answer 401/403 the way `upload-url.ts` already does.
 */
function refusalFrom(run: () => unknown): AuthorizationError {
  try {
    run();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal, but the call returned");
}

describe("requirePermission carries a refusal status", () => {
  const attendee: SessionUser = { id: "u1", email: "a@example.com", role: "attendee" };

  it("refuses a missing session with 401 Unauthorized", () => {
    const refusal = refusalFrom(() => requirePermission(null, { note: ["read"] }));

    expect(refusal.status).toBe(401);
    expect(refusal.message).toBe("Unauthorized");
  });

  it("refuses an unpermitted action with 403 Forbidden", () => {
    const refusal = refusalFrom(() => requirePermission(attendee, { upload: ["create"] }));

    expect(refusal.status).toBe(403);
    expect(refusal.message).toBe("Forbidden");
  });

  it("returns the user when the role permits the action", () => {
    expect(requirePermission(attendee, { note: ["read"] })).toBe(attendee);
  });
});
