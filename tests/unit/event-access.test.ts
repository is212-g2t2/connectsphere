import { describe, expect, it } from "vitest";

import {
  eventTiming,
  getEventAccess,
  isRegistrationWindowOpen,
  isVenueQueueRow,
  projectEvent,
} from "#/features/events/access";

const request = {
  id: 1,
  name: "ConnectSphere Demo",
  description: "A demo event",
  status: "submitted" as const,
  proposedDates: [{ start: "2026-10-01T09:00", end: "2026-10-01T17:00" }],
  expectedAttendance: 100,
  roomLayoutPreference: "Theatre",
  accessibilityRequirements: "Step-free access",
  venueRequirements: "Projector",
  registrationOpensAt: null,
  registrationClosesAt: null,
};

const relationship = {
  role: "attendee",
  userId: "attendee-1",
  organiserId: "organiser-1",
  assignedCoordinatorId: "coordinator-1",
  venueStaffIds: ["venue-1"],
  technicalSupportIds: ["tech-1"],
  isRegistrationWindowOpen: false,
  hasOwnRegistration: false,
};

describe("event access", () => {
  it.each([
    ["event_organiser", "organiser", "organiser-1"],
    ["event_coordinator", "coordinator", "coordinator-1"],
    ["venue_staff", "venue_staff", "venue-1"],
    ["technical_support_staff", "technical_support", "tech-1"],
  ])("grants %s access only through its relationship", (role, access, userId) => {
    expect(getEventAccess({ ...relationship, role, userId })).toBe(access);
    expect(getEventAccess({ ...relationship, role, userId: "unrelated-user" })).toBeNull();
  });

  it("allows attendees only to open registration windows, or events they are already registered for", () => {
    expect(getEventAccess(relationship)).toBeNull();
    expect(getEventAccess({ ...relationship, isRegistrationWindowOpen: true })).toBe("attendee");
    expect(getEventAccess({ ...relationship, hasOwnRegistration: true })).toBe("attendee");
  });

  it("redacts venue staff responses to the request directed at them", () => {
    const result = projectEvent(
      request,
      "venue_staff",
      null,
      [{ id: "line-1", item: "Projector", arrangementStatus: "reserved", notes: "Private note" }],
      { status: "pending" }
    );
    expect(result.event).toMatchObject({
      eventDate: "2026-10-01",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 100,
      layout: "Theatre",
      accessibilityRequirements: "Step-free access",
      requiredFacilities: "Projector",
      venueRequest: { status: "pending" },
    });
    expect(result.event).not.toHaveProperty("name");
    expect(result.event).not.toHaveProperty("description");
    expect(result.event).not.toHaveProperty("equipment");
  });

  it("redacts technical support responses to equipment fields", () => {
    const result = projectEvent(
      request,
      "technical_support",
      null,
      [{ id: "line-1", item: "Projector", arrangementStatus: "reserved", notes: "Private note" }],
      null
    );
    expect(result.event.equipment).toHaveLength(1);
    expect(result.event.name).toBe("ConnectSphere Demo");
    expect(result.event).not.toHaveProperty("description");
  });

  it("returns only an attendee's own registration and the PTR-44 fields", () => {
    const result = projectEvent(
      request,
      "attendee",
      { status: "registered", registeredAt: "2026-09-13T10:00:00.000Z" },
      [],
      null
    );
    expect(result.event.registration?.status).toBe("registered");
    expect(result.event).toMatchObject({
      name: "ConnectSphere Demo",
      description: "A demo event",
      eventDate: "2026-10-01",
    });
    expect(result.event).not.toHaveProperty("expectedAttendance");
    expect(result.event).not.toHaveProperty("equipment");
  });

  it.each(["attendee", "venue_staff", "technical_support", "organiser", "coordinator"] as const)(
    "carries the event's stage for the %s, who has access to it (PTR-21 AC2)",
    access => {
      const result = projectEvent(request, access, null, [], null);
      expect(result.event.status).toBe("submitted");
    }
  );

  it.each(["organiser", "coordinator"] as const)("projects the full record for the %s", access => {
    const result = projectEvent(request, access, null, [], { status: "pending" });

    expect(result.event).toMatchObject({
      name: "ConnectSphere Demo",
      status: "submitted",
      expectedAttendance: 100,
      equipment: [],
      venueRequest: { status: "pending" },
    });
  });
});

describe("projectEvent with a rejected venue request (PTR-34 AC3)", () => {
  const rejected = {
    status: "rejected",
    rejection: {
      reason: "Closed for floor resurfacing",
      suggestion: {
        venueName: "Harbour Hall",
        date: "2026-10-14",
        startTime: "10:00",
        endTime: "13:30",
      },
    },
  };

  it("carries the rejection's reason and suggestion to the coordinator", () => {
    const result = projectEvent(request, "coordinator", null, [], rejected);

    expect(result.event.venueRequest).toEqual(rejected);
  });
});

describe("isVenueQueueRow", () => {
  it("connects a Venue Staff member to their own rows and to the unassigned pending queue", () => {
    expect(isVenueQueueRow({ assignedStaffId: "venue-1", status: "pending" }, "venue-1")).toBe(
      true
    );
    expect(isVenueQueueRow({ assignedStaffId: null, status: "pending" }, "venue-1")).toBe(true);
  });

  it("does not connect another staff member's row or a settled unassigned one", () => {
    expect(isVenueQueueRow({ assignedStaffId: "venue-2", status: "pending" }, "venue-1")).toBe(
      false
    );
    expect(isVenueQueueRow({ assignedStaffId: null, status: "withdrawn" }, "venue-1")).toBe(false);
  });
});

describe("eventTiming", () => {
  it("uses the first complete proposed window", () => {
    expect(
      eventTiming([
        { start: "2026-10-01T09:00" },
        { start: "2026-11-02T10:00", end: "2026-11-02T12:30" },
      ])
    ).toEqual({
      eventDate: "2026-11-02",
      endDate: "2026-11-02",
      startTime: "10:00",
      endTime: "12:30",
    });
  });

  it("returns nothing when no window is complete", () => {
    expect(eventTiming([])).toEqual({
      eventDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
    });
    expect(eventTiming([{ start: "2026-10-01T09:00" }, { end: "2026-10-01T10:00" }])).toEqual({
      eventDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
    });
  });
});

describe("isRegistrationWindowOpen", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const terms = {
    registrationEnabled: true,
    registrationOpensAt: "2026-09-01T09:00",
    registrationClosesAt: "2026-10-01T17:00",
  };

  it("is open between the stored local times", () => {
    expect(isRegistrationWindowOpen(terms, now)).toBe(true);
    expect(
      isRegistrationWindowOpen({ ...terms, registrationOpensAt: "2026-09-17T11:59" }, now)
    ).toBe(true);
  });

  it("is closed before the window, after it, or without terms", () => {
    expect(
      isRegistrationWindowOpen({ ...terms, registrationOpensAt: "2026-09-17T12:01" }, now)
    ).toBe(false);
    expect(
      isRegistrationWindowOpen({ ...terms, registrationClosesAt: "2026-09-17T11:59" }, now)
    ).toBe(false);
    expect(isRegistrationWindowOpen({ ...terms, registrationEnabled: false }, now)).toBe(false);
    expect(
      isRegistrationWindowOpen(
        { registrationEnabled: true, registrationOpensAt: null, registrationClosesAt: null },
        now
      )
    ).toBe(false);
  });
});
