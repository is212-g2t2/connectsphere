import { describe, expect, it } from "vitest";

import { can } from "#/features/auth/permissions";
import { RoleSchema } from "#/features/auth/schema/role";
import type { Role } from "#/features/auth/schema/role";

/** Repeat the role/function matrix from PTR-7, PTR-9, PTR-15, PTR-26, PTR-31, PTR-32, PTR-36,
 * PTR-45, PTR-111, and PTR-144 independently of `permissions.ts`. Keep both copies so a permission change
 * must update both places. `Record<Role, …>` makes a new role fail `type:check` first.
 */
const EXPECTED: Record<
  Role,
  {
    eventRegister: boolean;
    event_request: boolean;
    coordinate: boolean;
    oversee: boolean;
    venueRead: boolean;
    venueSearch: boolean;
    venueCreate: boolean;
    venueUpdate: boolean;
    venueRequest: boolean;
    venueRequestRead: boolean;
    venueDecide: boolean;
    equipmentReserve: boolean;
    equipmentRelease: boolean;
    vipManage: boolean;
    eventRegistrationRead: boolean;
  }
> = {
  attendee: {
    eventRegister: true,
    event_request: false,
    coordinate: false,
    oversee: false,
    venueRead: false,
    venueSearch: false,
    venueCreate: false,
    venueUpdate: false,
    venueRequest: false,
    venueRequestRead: false,
    venueDecide: false,
    equipmentReserve: false,
    equipmentRelease: false,
    vipManage: false,
    eventRegistrationRead: false,
  },
  event_organiser: {
    eventRegister: false,
    event_request: true,
    coordinate: false,
    oversee: false,
    venueRead: false,
    venueSearch: false,
    venueCreate: false,
    venueUpdate: false,
    venueRequest: false,
    venueRequestRead: false,
    venueDecide: false,
    equipmentReserve: false,
    equipmentRelease: false,
    vipManage: true,
    eventRegistrationRead: true,
  },
  event_coordinator: {
    eventRegister: false,
    event_request: false,
    coordinate: true,
    oversee: false,
    venueRead: true,
    venueSearch: true,
    venueCreate: false,
    venueUpdate: false,
    venueRequest: true,
    venueRequestRead: false,
    venueDecide: false,
    equipmentReserve: false,
    equipmentRelease: false,
    vipManage: true,
    eventRegistrationRead: true,
  },
  event_coordinator_lead: {
    eventRegister: false,
    event_request: false,
    coordinate: false,
    oversee: true,
    venueRead: false,
    venueSearch: false,
    venueCreate: false,
    venueUpdate: false,
    venueRequest: false,
    venueRequestRead: false,
    venueDecide: false,
    equipmentReserve: false,
    equipmentRelease: false,
    vipManage: false,
    eventRegistrationRead: false,
  },
  venue_staff: {
    eventRegister: false,
    event_request: false,
    coordinate: false,
    oversee: false,
    venueRead: true,
    venueSearch: false,
    venueCreate: true,
    venueUpdate: true,
    venueRequest: false,
    venueRequestRead: true,
    venueDecide: true,
    equipmentReserve: false,
    equipmentRelease: false,
    vipManage: false,
    eventRegistrationRead: false,
  },
  technical_support_staff: {
    eventRegister: false,
    event_request: false,
    coordinate: false,
    oversee: false,
    venueRead: true,
    venueSearch: false,
    venueCreate: false,
    venueUpdate: false,
    venueRequest: false,
    venueRequestRead: false,
    venueDecide: false,
    equipmentReserve: true,
    equipmentRelease: true,
    vipManage: false,
    eventRegistrationRead: false,
  },
};

describe("role/function matrix (PTR-7, PTR-9, PTR-15, PTR-26, PTR-31, PTR-32, PTR-36, PTR-41, PTR-42, PTR-45, PTR-111, PTR-144)", () => {
  it.each(RoleSchema.options)("grants %s exactly its row of the matrix", role => {
    expect(can(role, { event: ["register"] })).toBe(EXPECTED[role].eventRegister);
    expect(can(role, { event_request: ["create"] })).toBe(EXPECTED[role].event_request);
    expect(can(role, { event_request: ["coordinate"] })).toBe(EXPECTED[role].coordinate);
    expect(can(role, { event_request: ["oversee"] })).toBe(EXPECTED[role].oversee);
    expect(can(role, { venue: ["read"] })).toBe(EXPECTED[role].venueRead);
    expect(can(role, { venue: ["search"] })).toBe(EXPECTED[role].venueSearch);
    expect(can(role, { venue: ["create"] })).toBe(EXPECTED[role].venueCreate);
    expect(can(role, { venue: ["update"] })).toBe(EXPECTED[role].venueUpdate);
    expect(can(role, { venue_request: ["request"] })).toBe(EXPECTED[role].venueRequest);
    expect(can(role, { venue_request: ["read"] })).toBe(EXPECTED[role].venueRequestRead);
    expect(can(role, { venue_request: ["decide"] })).toBe(EXPECTED[role].venueDecide);
    expect(can(role, { equipment: ["reserve"] })).toBe(EXPECTED[role].equipmentReserve);
    expect(can(role, { equipment: ["release"] })).toBe(EXPECTED[role].equipmentRelease);
    expect(can(role, { vip_registration: ["manage"] })).toBe(EXPECTED[role].vipManage);
    expect(can(role, { event_registration: ["read"] })).toBe(EXPECTED[role].eventRegistrationRead);
  });

  describe("fails closed", () => {
    /** Each probe is a malformed spelling of a role with `event_request:create`, or an unknown
     * role. Do not use `attendee`: it lacks that permission, so an unknown role that falls back to
     * `attendee` would still pass this test.
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
      expect(can(role, { event_request: ["create"] })).toBe(false);
    });

    // Criterion 4: Better Auth's `admin` plugin reads this string as two roles. Do not use it.
    it("refuses a comma-separated pair of roles", () => {
      expect(can("attendee,event_coordinator", { event_request: ["create"] })).toBe(false);
    });
  });
});
