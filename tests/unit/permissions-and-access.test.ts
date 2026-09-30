import { describe, expect, test } from "vitest";

import { can } from "#/features/auth/permissions";
import { getEventAccess, projectEvent } from "#/features/events/access";
import type { EventAccess } from "#/features/events/access";

describe("can(): equipment_request", () => {
  const manageAndSubmit = { equipment_request: ["manage", "submit"] } as const;

  test("event_coordinator holds manage and submit", () => {
    expect(can("event_coordinator", { equipment_request: ["manage"] })).toBe(true);
    expect(can("event_coordinator", { equipment_request: ["submit"] })).toBe(true);
    expect(can("event_coordinator", manageAndSubmit)).toBe(true);
  });

  test.each(["event_organiser", "venue_staff", "technical_support_staff", "attendee"])(
    "%s holds neither",
    role => {
      expect(can(role, { equipment_request: ["manage"] })).toBe(false);
      expect(can(role, { equipment_request: ["submit"] })).toBe(false);
    }
  );

  test.each([null, undefined, "", "admin", "event_coordinator,venue_staff"])(
    "fails closed for %p",
    role => {
      expect(can(role, { equipment_request: ["manage"] })).toBe(false);
    }
  );
});

describe("can(): equipment_request read and arrange (PTR-39)", () => {
  test("grants the equipment read and arrange functions to Technical Support only", () => {
    expect(can("technical_support_staff", { equipment_request: ["read"] })).toBe(true);
    expect(can("technical_support_staff", { equipment_request: ["arrange"] })).toBe(true);

    for (const role of ["attendee", "event_organiser", "event_coordinator", "venue_staff"]) {
      expect(can(role, { equipment_request: ["read"] })).toBe(false);
      expect(can(role, { equipment_request: ["arrange"] })).toBe(false);
    }
  });

  test("Technical Support still cannot manage or submit a Coordinator's lines", () => {
    expect(can("technical_support_staff", { equipment_request: ["manage"] })).toBe(false);
    expect(can("technical_support_staff", { equipment_request: ["submit"] })).toBe(false);
  });
});

const record: Parameters<typeof projectEvent>[0] = {
  id: 7,
  name: "Summit",
  description: "desc",
  status: "approved",
  proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
  equipmentSubmittedAt: new Date("2030-01-01T00:00:00Z"),
  expectedAttendance: 100,
  roomLayoutPreference: "Theatre",
  accessibilityRequirements: "Step-free",
  venueRequirements: "Projector",
  registrationOpensAt: null,
  registrationClosesAt: null,
};
const equipment = [
  {
    id: "l1",
    item: "Projector",
    quantity: 2,
    arrangementStatus: "pending",
    notes: null,
    reservedQuantity: null,
  },
];

const project = (access: EventAccess, rec = record) =>
  projectEvent(rec, access, null, equipment, null).event;

describe("projectEvent: equipment fields", () => {
  test.each(["coordinator", "organiser"] as const)("%s gets equipment + ISO submittedAt", a => {
    const e = project(a);
    expect(e.equipment).toEqual(equipment);
    expect(e.equipmentSubmittedAt).toBe("2030-01-01T00:00:00.000Z");
  });

  test("submittedAt is null when unset", () => {
    expect(
      project("coordinator", { ...record, equipmentSubmittedAt: null }).equipmentSubmittedAt
    ).toBeNull();
    expect(
      project("coordinator", { ...record, equipmentSubmittedAt: undefined }).equipmentSubmittedAt
    ).toBeNull();
  });

  test("technical_support gets equipment but not submittedAt", () => {
    const e = project("technical_support");
    expect(e.equipment).toEqual(equipment);
    expect("equipmentSubmittedAt" in e).toBe(false);
  });

  test.each(["venue_staff", "attendee"] as const)("%s gets no equipment key", a => {
    expect("equipment" in project(a)).toBe(false);
  });
});

describe("getEventAccess: coordinator", () => {
  const base = {
    userId: "c1",
    organiserId: "o1",
    assignedCoordinatorId: "c1",
    venueStaffIds: [],
    technicalSupportIds: [],
    isRegistrationWindowOpen: false,
    hasOwnRegistration: false,
  };
  test("only the assigned coordinator", () => {
    expect(getEventAccess({ ...base, role: "event_coordinator" })).toBe("coordinator");
    expect(
      getEventAccess({ ...base, role: "event_coordinator", assignedCoordinatorId: "c2" })
    ).toBeNull();
    expect(
      getEventAccess({ ...base, role: "event_coordinator", assignedCoordinatorId: null })
    ).toBeNull();
  });
});
