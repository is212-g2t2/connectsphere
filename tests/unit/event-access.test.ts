import { describe, expect, it } from "vitest";

import { getEventAccess, projectEvent } from "#/features/events/access";

const event = {
  id: "event-1",
  name: "ConnectSphere Demo",
  description: "A demo event",
  eventDate: "2026-10-01",
  startTime: "09:00:00",
  endTime: "17:00:00",
  venue: "Main Hall",
  status: "confirmed",
  registrationOpensAt: null,
  registrationClosesAt: null,
  expectedAttendance: 100,
  layout: "Theatre",
  accessibilityRequirements: "Step-free access",
  requiredFacilities: "Projector",
};

describe("event access", () => {
  it.each([
    ["event_organiser", "organiser", "organiser-1"],
    ["event_coordinator", "coordinator", "coordinator-1"],
    ["venue_staff", "venue_staff", "venue-1"],
    ["technical_support_staff", "technical_support", "tech-1"],
  ])("grants %s access only through its relationship", (role, access, userId) => {
    expect(
      getEventAccess({
        role,
        userId,
        createdById: "organiser-1",
        coordinatorIds: ["coordinator-1"],
        venueStaffIds: ["venue-1"],
        technicalSupportIds: ["tech-1"],
        isPublishedForRegistration: true,
        hasOwnRegistration: false,
      })
    ).toBe(access);
    expect(
      getEventAccess({
        role,
        userId: "unrelated-user",
        createdById: "organiser-1",
        coordinatorIds: ["coordinator-1"],
        venueStaffIds: ["venue-1"],
        technicalSupportIds: ["tech-1"],
        isPublishedForRegistration: true,
        hasOwnRegistration: false,
      })
    ).toBeNull();
  });

  it("allows attendees only to published registration events, or events they are already registered for", () => {
    const relationship = {
      role: "attendee",
      userId: "attendee-1",
      createdById: "organiser-1",
      coordinatorIds: [],
      venueStaffIds: [],
      technicalSupportIds: [],
      isPublishedForRegistration: false,
      hasOwnRegistration: false,
    };
    expect(getEventAccess(relationship)).toBeNull();
    expect(getEventAccess({ ...relationship, isPublishedForRegistration: true })).toBe("attendee");
    expect(getEventAccess({ ...relationship, hasOwnRegistration: true })).toBe("attendee");
  });

  it("redacts venue staff responses to venue-request fields", () => {
    const result = projectEvent(
      event,
      "venue_staff",
      null,
      [{ item: "Projector", arrangementStatus: "reserved", notes: "Private note" }],
      { status: "pending" }
    );
    expect(result.event).toMatchObject({
      name: "ConnectSphere Demo",
      venue: "Main Hall",
      expectedAttendance: 100,
    });
    expect(result.event).not.toHaveProperty("description");
    expect(result.event).not.toHaveProperty("equipment");
  });

  it("redacts technical support responses to equipment fields", () => {
    const result = projectEvent(event, "technical_support", null, [
      { item: "Projector", arrangementStatus: "reserved", notes: "Private note" },
    ]);
    expect(result.event.equipment).toHaveLength(1);
    expect(result.event).not.toHaveProperty("description");
    expect(result.event).not.toHaveProperty("venue");
  });

  it("returns only an attendee's own registration", () => {
    const result = projectEvent(event, "attendee", {
      status: "registered",
      registeredAt: "2026-09-13",
    });
    expect(result.event.registration?.status).toBe("registered");
    expect(result.event).not.toHaveProperty("expectedAttendance");
    expect(result.event).not.toHaveProperty("equipment");
  });
});
