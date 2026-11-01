import { describe, expect, it } from "vitest";

import { ROLE_LABELS, RoleSchema, roleLabel } from "#/features/auth/schema/role";

describe("roleLabel", () => {
  it("labels all seven roles", () => {
    expect(Object.keys(ROLE_LABELS)).toEqual([...RoleSchema.options]);
    for (const role of RoleSchema.options) {
      expect(roleLabel(role)).toBe(ROLE_LABELS[role]);
    }
  });

  it("falls back to Attendee for a missing role", () => {
    expect(roleLabel(null)).toBe("Attendee");
    expect(roleLabel(undefined)).toBe("Attendee");
  });

  it("keeps an unknown value raw instead of hiding it", () => {
    expect(roleLabel("archivist")).toBe("archivist");
  });
});
