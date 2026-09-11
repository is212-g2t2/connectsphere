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
const EXPECTED: Record<Role, { upload: boolean }> = {
  attendee: { upload: false },
  event_organiser: { upload: true },
  event_coordinator: { upload: true },
  venue_staff: { upload: true },
  technical_support_staff: { upload: true },
};

describe("role/function matrix (PTR-7)", () => {
  it.each(RoleSchema.options)("grants %s exactly its row of the matrix", role => {
    expect(can(role, { upload: ["create"] })).toBe(EXPECTED[role].upload);
  });

  describe("fails closed", () => {
    /**
     * Every probe is a malformed spelling of a role that *does* hold `upload:create`, or a role
     * that does not exist. Spelling them as `attendee` would prove nothing: attendee holds an
     * empty role, so a `can()` that quietly defaulted an unknown string to it would still answer
     * false and this block would pass while enforcing nothing.
     */
    it.each<string | null | undefined>([
      null,
      undefined,
      "",
      "admin",
      "Event_Organiser",
      "EVENT_ORGANISER",
      " event_organiser ",
      "event-organiser",
    ])("refuses the role %o", role => {
      expect(can(role, { upload: ["create"] })).toBe(false);
    });

    // Criterion 4. Better Auth's `admin` plugin reads such a string as two roles at once,
    // which is precisely why this project does not use it.
    it("refuses a comma-separated pair of roles", () => {
      expect(can("attendee,event_coordinator", { upload: ["create"] })).toBe(false);
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
  const organiser: SessionUser = { id: "u2", email: "o@example.com", role: "event_organiser" };

  it("refuses a missing session with 401 Unauthorized", () => {
    const refusal = refusalFrom(() => requirePermission(null, { upload: ["create"] }));

    expect(refusal.status).toBe(401);
    expect(refusal.message).toBe("Unauthorized");
  });

  it("refuses an unpermitted action with 403 Forbidden", () => {
    const refusal = refusalFrom(() => requirePermission(attendee, { upload: ["create"] }));

    expect(refusal.status).toBe(403);
    expect(refusal.message).toBe("Forbidden");
  });

  it("returns the user when the role permits the action", () => {
    expect(requirePermission(organiser, { upload: ["create"] })).toBe(organiser);
  });
});
