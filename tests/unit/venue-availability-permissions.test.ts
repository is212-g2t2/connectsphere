import { describe, expect, it } from "vitest";

import { can } from "#/features/auth/permissions";
import { AuthorizationError, requirePermission } from "#/features/auth/session";
import { createPtr28Fixture } from "../fixtures/ptr-28";

// These verify the existing shared guard only. They do not count as page or endpoint tests.
describe("PTR-28 availability permission (unit)", () => {
  it.each([
    { caseId: "TC01", role: "event_coordinator" },
    { caseId: "TC02", role: "venue_staff" },
  ])("[PTR-28-$caseId][AC1] grants the story's $role role availability read access", ({ role }) => {
    const user = createPtr28Fixture().accounts.find(account => account.role === role);
    expect(user).toBeDefined();
    expect(can(role, { venueAvailability: ["read"] })).toBe(true);
    expect(requirePermission(user ?? null, { venueAvailability: ["read"] })).toBe(user);
  });

  it.each([
    { variant: "A", role: "attendee" },
    { variant: "B", role: "event_organiser" },
  ])("[PTR-28-TC14-$variant][AC5] refuses $role at the permission helper", ({ role }) => {
    const user = createPtr28Fixture().accounts.find(account => account.role === role);
    expect(user).toBeDefined();
    expect(can(role, { venueAvailability: ["read"] })).toBe(false);
    expect(() => requirePermission(user ?? null, { venueAvailability: ["read"] })).toThrow(
      new AuthorizationError("Forbidden", 403)
    );
  });

  it("[PTR-28-TC18-B][AC1][AC5] refuses a missing session at the permission helper", () => {
    expect(() => requirePermission(null, { venueAvailability: ["read"] })).toThrow(
      new AuthorizationError("Unauthorized", 401)
    );
  });

  it.each([undefined, null, "", "admin", "attendee,event_coordinator", "event_coordinator "])(
    "[PTR-28-TC14][AC5] fails closed for the malformed role %o",
    role => {
      expect(can(role, { venueAvailability: ["read"] })).toBe(false);
    }
  );
  // Technical Support Staff entitlement is unresolved; no product entitlement assertion.
});
