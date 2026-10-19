import { describe, expect, it } from "vitest";

import {
  eventTiming,
  getEventAccess,
  isEquipmentQueueRow,
  isPublishedForAttendees,
  isVenueQueueRow,
  projectEvent,
} from "#/features/events/access";
import type { EventVenueRequest } from "#/features/events/access";

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
  registrationEnabled: true,
};

const relationship = {
  role: "attendee",
  userId: "attendee-1",
  organiserId: "organiser-1",
  assignedCoordinatorId: "coordinator-1",
  venueStaffIds: ["venue-1"],
  technicalSupportIds: ["tech-1"],
  status: "confirmed" as const,
  registrationEnabled: true,
  hasOwnRegistration: false,
  hasSafetyReview: false,
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

  it("grants the lead every non-draft event with no relationship check", () => {
    expect(getEventAccess({ ...relationship, role: "event_coordinator_lead" })).toBe("lead");
    expect(
      getEventAccess({
        ...relationship,
        role: "event_coordinator_lead",
        userId: "unrelated-user",
        assignedCoordinatorId: null,
      })
    ).toBe("lead");
    // A draft never reaches a projection, so the helper fails closed on it (PTR-144).
    expect(
      getEventAccess({ ...relationship, role: "event_coordinator_lead", status: "draft" })
    ).toBeNull();
  });

  it("still grants the lead an unassigned event; the projection flag carries the assignment", () => {
    expect(
      getEventAccess({
        ...relationship,
        role: "event_coordinator_lead",
        assignedCoordinatorId: null,
      })
    ).toBe("lead");
    const unassigned = projectEvent(
      { ...request, assignedCoordinatorId: null },
      "lead",
      null,
      [],
      []
    );
    expect(unassigned.event.awaitingAssignment).toBe(true);
  });

  it("grants a Safety Officer every event with a review, and no event without one (PTR-146)", () => {
    expect(
      getEventAccess({
        ...relationship,
        role: "safety_officer",
        userId: "safety-1",
        hasSafetyReview: true,
      })
    ).toBe("safety_officer");
    expect(
      getEventAccess({ ...relationship, role: "safety_officer", userId: "safety-1" })
    ).toBeNull();
    // A draft never carries a review; the guard mirrors the SQL relationship (PTR-146).
    expect(
      getEventAccess({
        ...relationship,
        role: "safety_officer",
        userId: "safety-1",
        hasSafetyReview: true,
        status: "draft",
      })
    ).toBeNull();
  });

  it("allows attendees only confirmed events with registration on, or events they are already registered for (PTR-44)", () => {
    // A confirmed, enabled event shows to the browsing attendee.
    expect(getEventAccess(relationship)).toBe("attendee");
    // A missing half of the pair denies a browsing attendee.
    expect(getEventAccess({ ...relationship, status: "submitted" })).toBeNull();
    expect(getEventAccess({ ...relationship, registrationEnabled: false })).toBeNull();
    // An own registration keeps a non-draft event visible.
    expect(getEventAccess({ ...relationship, status: "submitted", hasOwnRegistration: true })).toBe(
      "attendee"
    );
    // A draft stays hidden with an own registration. A submitted event with one shows.
    expect(getEventAccess({ ...relationship, status: "draft", hasOwnRegistration: true })).toBe(
      null
    );
    // Each role uses its own relationship. No role borrows another's.
    expect(
      getEventAccess({ ...relationship, role: "event_organiser", userId: "organiser-1" })
    ).toBe("organiser");
    expect(getEventAccess({ ...relationship, role: "visitor" })).toBeNull();
  });

  describe("confirmation (PTR-24)", () => {
    const confirmedRequest = {
      ...request,
      status: "confirmed" as const,
      confirmedAt: new Date("2026-10-02T03:00:00Z"),
      confirmedByName: "Casey Coordinator",
    };
    const booking = {
      name: "Hall A",
      location: "Fixture location",
      date: "2026-10-01",
      endDate: "2026-10-01",
      startTime: "09:00",
      endTime: "12:30",
    };

    it.each(["organiser", "coordinator"] as const)(
      "projects who confirmed, when, and the booked venue for the %s",
      access => {
        const result = projectEvent(confirmedRequest, access, null, [], [], booking);
        expect(result.event.confirmation).toEqual({
          confirmedAt: "2026-10-02T03:00:00.000Z",
          confirmedByName: "Casey Coordinator",
          venue: booking,
        });
      }
    );

    it("carries a null venue once the booking has been released", () => {
      const result = projectEvent(confirmedRequest, "organiser", null, [], []);
      expect(result.event.confirmation?.venue).toBeNull();
    });

    it("carries no confirmation before the event is confirmed", () => {
      const result = projectEvent(request, "organiser", null, [], [], booking);
      expect(result.event.confirmation).toBeNull();
    });

    it.each(["venue_staff", "technical_support", "attendee"] as const)(
      "withholds the confirmation record from %s",
      access => {
        const result = projectEvent(confirmedRequest, access, null, [], [], booking);
        expect(result.event).not.toHaveProperty("confirmation");
      }
    );
  });

  it("redacts venue staff responses to the request directed at them", () => {
    const result = projectEvent(
      request,
      "venue_staff",
      null,
      [
        {
          id: "line-1",
          item: "Projector",
          quantity: 1,
          arrangementStatus: "reserved",
          notes: "Private note",
        },
      ],
      [
        {
          id: "vr-9",
          status: "pending",
          venueName: "Hall A",
          date: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
        },
      ]
    );
    expect(result.event).toMatchObject({
      eventDate: "2026-10-01",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 100,
      layout: "Theatre",
      accessibilityRequirements: "Step-free access",
      requiredFacilities: "Projector",
      venueRequests: [{ status: "pending", venueName: "Hall A" }],
    });
    expect(result.event).not.toHaveProperty("name");
    expect(result.event).not.toHaveProperty("description");
    expect(result.event).not.toHaveProperty("equipment");
  });

  it("carries a venue staff member's settled request with its outcome", () => {
    for (const venueRequest of [
      {
        id: "vr-9",
        status: "approved",
        venueName: "Hall A",
        date: "2026-10-10",
        startTime: "09:00",
        endTime: "12:00",
      },
      {
        id: "vr-9",
        status: "rejected",
        venueName: "Hall A",
        date: "2026-10-10",
        startTime: "09:00",
        endTime: "12:00",
        rejection: {
          venueId: 5,
          reason: "Closed for floor resurfacing",
          suggestion: null,
          suggestedVenueId: null,
        },
      },
      {
        id: "vr-9",
        status: "released",
        venueName: "Hall A",
        date: "2026-10-10",
        startTime: "09:00",
        endTime: "12:00",
        release: {
          reason: "Air-conditioning failure",
          changedByName: null,
        },
      },
    ] as const) {
      const result = projectEvent(request, "venue_staff", null, [], [venueRequest]);
      expect(result.event.venueRequests).toEqual([venueRequest]);
      expect(result.event).not.toHaveProperty("name");
    }
  });
  it("redacts technical support responses to equipment fields", () => {
    const result = projectEvent(
      request,
      "technical_support",
      null,
      [
        {
          id: "line-1",
          item: "Projector",
          quantity: 1,
          arrangementStatus: "reserved",
          notes: "Private note",
        },
      ],
      []
    );
    expect(result.event.equipment).toHaveLength(1);
    expect(result.event.name).toBe("ConnectSphere Demo");
    expect(result.event.description).toBe("A demo event");
  });

  describe("arrangement notes and reasons (PTR-39 AC4)", () => {
    const arranged = [
      {
        id: "line-1",
        item: "Projector",
        quantity: 1,
        arrangementStatus: "unavailable",
        notes: "Coordinator note",
        arrangementNotes: "Technical Support note",
        unavailableReason: "Loaned out",
      },
    ];

    it("projects arrangement notes and the unavailable reason for the coordinator and technical support", () => {
      for (const access of ["coordinator", "technical_support"] as const) {
        const [projected] = projectEvent(request, access, null, arranged, []).event.equipment ?? [];
        expect(projected).toMatchObject({
          arrangementStatus: "unavailable",
          notes: "Coordinator note",
          arrangementNotes: "Technical Support note",
          unavailableReason: "Loaned out",
        });
      }
    });

    it("withholds Technical Support notes and reasons from the organiser", () => {
      const [projected] =
        projectEvent(request, "organiser", null, arranged, []).event.equipment ?? [];
      expect(projected).toMatchObject({
        arrangementStatus: "unavailable",
        notes: "Coordinator note",
      });
      expect(projected).not.toHaveProperty("arrangementNotes");
      expect(projected).not.toHaveProperty("unavailableReason");
    });

    it("keeps the holder's name and arrangeable flag to technical support alone", () => {
      const held = [{ ...arranged[0], arrangeable: true, assignedStaffName: "Sam" }];
      const project = (access: "coordinator" | "organiser" | "technical_support") =>
        projectEvent(request, access, null, held, []).event.equipment?.[0];
      expect(project("technical_support")).toMatchObject({
        arrangeable: true,
        assignedStaffName: "Sam",
      });
      for (const access of ["coordinator", "organiser"] as const) {
        expect(project(access)).not.toHaveProperty("assignedStaffName");
        expect(project(access)).not.toHaveProperty("arrangeable");
      }
    });
  });

  describe("the Safety Officer's projection (PTR-146)", () => {
    const venue = {
      name: "Hall A",
      location: "Fixture location",
      date: "2026-10-01",
      endDate: "2026-10-01",
      startTime: "09:00",
      endTime: "17:00",
    };
    const line = {
      id: "line-1",
      item: "Projector",
      quantity: 2,
      arrangementStatus: "reserved",
      notes: "Needs a stand",
      arrangementNotes: "Reserved from the store",
      unavailableReason: null,
      reservedQuantity: 2,
    };

    it("carries the venue, its capacity, the layout and every equipment detail", () => {
      const result = projectEvent(request, "safety_officer", null, [line], [], venue, null, {
        venueCapacity: 120,
        sessionRequirements: {
          expectedAttendance: 90,
          layout: "Cabaret",
          accessibilityRequirements: "Ramp",
          requiredFacilities: "Stage",
        },
      });

      expect(result.event).toMatchObject({
        name: "ConnectSphere Demo",
        status: "submitted",
        expectedAttendance: 100,
        layout: "Theatre",
        accessibilityRequirements: "Step-free access",
        requiredFacilities: "Projector",
        venue,
        venueCapacity: 120,
        sessionRequirements: {
          expectedAttendance: 90,
          layout: "Cabaret",
          accessibilityRequirements: "Ramp",
          requiredFacilities: "Stage",
        },
        equipment: [
          {
            id: "line-1",
            item: "Projector",
            quantity: 2,
            arrangementStatus: "reserved",
            notes: "Needs a stand",
            reservedQuantity: 2,
          },
        ],
      });
      // Technical Support's internal notes and reasons stay with their roles.
      expect(result.event.equipment?.[0]).not.toHaveProperty("arrangementNotes");
      expect(result.event.equipment?.[0]).not.toHaveProperty("unavailableReason");
    });

    it("withholds the booking decisions and the confirmation record", () => {
      const result = projectEvent(
        request,
        "safety_officer",
        null,
        [],
        [
          {
            id: "vr-9",
            status: "pending",
            venueName: "Hall A",
            date: "2026-10-01",
            startTime: "09:00",
            endTime: "17:00",
          },
        ]
      );

      expect(result.event).not.toHaveProperty("venueRequests");
      expect(result.event).not.toHaveProperty("confirmation");
      expect(result.event).not.toHaveProperty("equipmentSubmittedAt");
    });
  });

  it("returns only an attendee's own registration and the PTR-44 fields", () => {
    const venue = {
      name: "Hall A",
      location: "Fixture location",
      date: "2026-10-01",
      endDate: "2026-10-01",
      startTime: "09:00",
      endTime: "17:00",
    };
    const result = projectEvent(
      request,
      "attendee",
      { status: "registered", registeredAt: "2026-09-13T10:00:00.000Z" },
      [],
      [],
      venue,
      { registered: 12, limit: 40, vip: 2, capacity: 40 }
    );
    expect(result.event.registration?.status).toBe("registered");
    expect(result.event.places).toEqual({ registered: 12, limit: 40, vip: 2, capacity: 40 });
    expect(result.event).toMatchObject({
      name: "ConnectSphere Demo",
      description: "A demo event",
      eventDate: "2026-10-01",
      startTime: "09:00",
      endTime: "17:00",
      registrationOpensAt: null,
      registrationClosesAt: null,
      venue,
    });
    expect(Object.keys(result.event).toSorted()).toEqual(
      [
        "description",
        "endDate",
        "endTime",
        "eventDate",
        "id",
        "name",
        "places",
        "registration",
        "registrationAvailability",
        "registrationClosesAt",
        "registrationEnabled",
        "registrationOpensAt",
        "startTime",
        "status",
        "venue",
      ].toSorted()
    );
  });

  it.each([
    "attendee",
    "venue_staff",
    "technical_support",
    "organiser",
    "coordinator",
    "lead",
  ] as const)("carries the event's stage for the %s, who has access to it (PTR-21 AC2)", access => {
    const result = projectEvent(request, access, null, [], []);
    expect(result.event.status).toBe("submitted");
  });

  it.each(["organiser", "coordinator"] as const)("projects the full record for the %s", access => {
    const result = projectEvent(
      request,
      access,
      null,
      [],
      [
        {
          id: "vr-9",
          status: "pending",
          venueName: "Hall A",
          date: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
        },
      ]
    );

    expect(result.event).toMatchObject({
      name: "ConnectSphere Demo",
      status: "submitted",
      expectedAttendance: 100,
      equipment: [],
      venueRequests: [{ status: "pending" }],
    });
  });

  it("projects the lead's read-only record with its assignment flag (PTR-144)", () => {
    const equipment = [
      {
        id: "line-1",
        item: "Projector",
        quantity: 1,
        arrangementStatus: "reserved",
        notes: "Coordinator note",
        arrangementNotes: "Technical Support note",
        unavailableReason: "Loaned out",
      },
    ];
    const assigned = projectEvent(
      { ...request, assignedCoordinatorId: "coordinator-1" },
      "lead",
      null,
      equipment,
      []
    );
    expect(assigned.event.awaitingAssignment).toBe(false);
    expect(assigned.event).not.toHaveProperty("blockedArrangements");
    expect(assigned.event).not.toHaveProperty("completionUnavailableReason");
    expect(assigned.event).not.toHaveProperty("equipmentArrangementsCompletedAt");
    const [line] = assigned.event.equipment ?? [];
    expect(line).toMatchObject({
      id: "line-1",
      item: "Projector",
      quantity: 1,
      arrangementStatus: "reserved",
      notes: "Coordinator note",
    });
    expect(line).not.toHaveProperty("arrangementNotes");
    expect(line).not.toHaveProperty("unavailableReason");
  });
});

describe("projectEvent with a rejected venue request (PTR-34 AC3)", () => {
  const rejected = {
    id: "vr-5",
    status: "rejected",
    venueName: "Main Hall",
    date: "2026-10-10",
    startTime: "09:00",
    endTime: "12:00",
    rejection: {
      venueId: 5,
      reason: "Closed for floor resurfacing",
      suggestion: {
        venueName: "Harbour Hall",
        date: "2026-10-14",
        startTime: "10:00",
        endTime: "13:30",
      },
      suggestedVenueId: 9,
    },
  } satisfies EventVenueRequest;

  it("carries the rejection's reason and suggestion to the coordinator", () => {
    const result = projectEvent(request, "coordinator", null, [], [rejected]);

    expect(result.event.venueRequests).toEqual([rejected]);
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

describe("isEquipmentQueueRow", () => {
  const cases: Array<{
    name: string;
    row: { assignedStaffId: string | null; arrangementStatus: string };
    submitted: boolean;
    expected: boolean;
  }> = [
    {
      name: "assigned to this staff member",
      row: { assignedStaffId: "tech-1", arrangementStatus: "requested" },
      submitted: false,
      expected: true,
    },
    {
      name: "assigned to another staff member",
      row: { assignedStaffId: "tech-2", arrangementStatus: "requested" },
      submitted: true,
      expected: false,
    },
    {
      name: "unassigned requested on a submitted event",
      row: { assignedStaffId: null, arrangementStatus: "requested" },
      submitted: true,
      expected: true,
    },
    {
      name: "unassigned requested before submit",
      row: { assignedStaffId: null, arrangementStatus: "requested" },
      submitted: false,
      expected: false,
    },
    {
      name: "unassigned reserved on a submitted event (the holder's account is gone)",
      row: { assignedStaffId: null, arrangementStatus: "reserved" },
      submitted: true,
      expected: true,
    },
    {
      name: "unassigned reserved before submit stays out of the queue",
      row: { assignedStaffId: null, arrangementStatus: "reserved" },
      submitted: false,
      expected: false,
    },
    {
      name: "unassigned unavailable on a submitted event stays out of the queue",
      row: { assignedStaffId: null, arrangementStatus: "unavailable" },
      submitted: true,
      expected: false,
    },
  ];

  it.each(cases)("$name -> $expected", ({ row, submitted, expected }) => {
    expect(isEquipmentQueueRow(row, "tech-1", submitted)).toBe(expected);
  });
});

describe("isPublishedForAttendees", () => {
  const cases: Array<{
    name: string;
    event: { status: "confirmed" | "submitted"; registrationEnabled?: boolean };
    expected: boolean;
  }> = [
    {
      name: "confirmed with registration on",
      event: { status: "confirmed", registrationEnabled: true },
      expected: true,
    },
    {
      name: "confirmed with registration off",
      event: { status: "confirmed", registrationEnabled: false },
      expected: false,
    },
    {
      name: "submitted with registration on",
      event: { status: "submitted", registrationEnabled: true },
      expected: false,
    },
    { name: "confirmed with the flag missing", event: { status: "confirmed" }, expected: false },
  ];
  it.each(cases)("$name -> $expected", ({ event, expected }) => {
    expect(isPublishedForAttendees(event)).toBe(expected);
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
