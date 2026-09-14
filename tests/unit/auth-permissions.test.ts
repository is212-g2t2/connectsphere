import { describe, expect, it } from "vitest";

import { can } from "#/features/auth/permissions";
import { RoleSchema } from "#/features/auth/schema/role";
import type { Role } from "#/features/auth/schema/role";

/**
 * The role/function matrix of PTR-7, PTR-9 and PTR-26, restated independently of
 * `permissions.ts`.
 *
 * The duplication is deliberate: widening a role has to be written twice and can never be a
 * slip. `Record<Role, …>` covers completeness, so a new role fails `type:check` before it
 * reaches here.
 */
const EXPECTED: Record<
  Role,
  {
    upload: boolean;
    event_request: boolean;
    venueRead: boolean;
    venueCreate: boolean;
    venueUpdate: boolean;
  }
> = {
  attendee: {
    upload: false,
    event_request: false,
    venueRead: false,
    venueCreate: false,
    venueUpdate: false,
  },
  event_organiser: {
    upload: true,
    event_request: true,
    venueRead: false,
    venueCreate: false,
    venueUpdate: false,
  },
  event_coordinator: {
    upload: true,
    event_request: false,
    venueRead: true,
    venueCreate: false,
    venueUpdate: false,
  },
  venue_staff: {
    upload: true,
    event_request: false,
    venueRead: true,
    venueCreate: true,
    venueUpdate: true,
  },
  technical_support_staff: {
    upload: true,
    event_request: false,
    venueRead: true,
    venueCreate: false,
    venueUpdate: false,
  },
};

describe("role/function matrix (PTR-7, PTR-9, PTR-26)", () => {
  it.each(RoleSchema.options)("grants %s exactly its row of the matrix", role => {
    expect(can(role, { upload: ["create"] })).toBe(EXPECTED[role].upload);
    expect(can(role, { event_request: ["create"] })).toBe(EXPECTED[role].event_request);
    expect(can(role, { venue: ["read"] })).toBe(EXPECTED[role].venueRead);
    expect(can(role, { venue: ["create"] })).toBe(EXPECTED[role].venueCreate);
    expect(can(role, { venue: ["update"] })).toBe(EXPECTED[role].venueUpdate);
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
