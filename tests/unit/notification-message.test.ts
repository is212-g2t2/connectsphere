import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_KINDS,
  notificationHref,
  notificationReachable,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";
import type { NotificationKind, NotificationPayload } from "#/features/notifications/message";

const requestedPayload = {
  venueRequestId: "request-1",
  venueName: "Harbour Hall",
  startsAt: "2026-10-12 14:00:00",
  endsAt: "2026-10-12 17:00:00",
  expectedAttendance: 80,
  layout: "Theatre",
  accessibilityRequirements: "Step-free access",
  requiredFacilities: "Projector",
};

const validPayloads = {
  venue_booking_requested: requestedPayload,
  venue_booking_approved: {
    venueRequestId: "request-1",
    eventName: "Gala",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
  },
  venue_booking_rejected: {
    venueRequestId: "request-1",
    eventName: "Gala",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    reason: "Fully booked",
    suggestion: null,
  },
  venue_booking_changed: {
    venueRequestId: "request-1",
    eventName: "Gala",
    action: "released",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    reason: "Maintenance",
  },
  clarification_requested: { eventName: "Gala", body: "Which layout?" },
  clarification_replied: { eventName: "Gala", question: "Which layout?", body: "Theatre" },
  event_change_requested: {
    eventName: "Gala",
    whatShouldChange: "Venue",
    requestedValue: "Harbour Hall",
  },
  handover_requested: { eventName: "Gala", fromName: "Alice" },
  handover_accepted: { eventName: "Gala", coordinatorName: "Bob" },
  handover_declined: { eventName: "Gala", coordinatorName: "Bob" },
  event_decided: { eventName: "Gala", decision: "approved" },
  event_confirmed: {
    eventName: "Gala",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    equipment: [{ id: "line-1", item: "Projector", quantity: 1, state: "Reserved" }],
  },
  equipment_requested: {
    eventName: "Gala",
    lines: [{ id: "line-1", item: "Projector", quantity: 1, notes: null }],
  },
  equipment_arrangements_completed: { eventName: "Gala", lineCount: 1 },
  equipment_unavailable: {
    eventName: "Gala",
    item: "Projector",
    quantity: 1,
    reason: "Damaged",
  },
  equipment_released: {
    eventName: "Gala",
    item: "Projector",
    requestedQuantity: 2,
    previousQuantity: 2,
    quantity: 1,
    arrangementStatus: "requested",
    unavailableReason: null,
    actorName: "Tara",
  },
  event_registered: {
    eventName: "Gala",
    venueName: "Harbour Hall",
    venueLocation: "Pier 3",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
  },
  registration_threshold_reached: {
    eventName: "Gala",
    registered: 40,
    limit: 40,
    audience: "organiser",
  },
  registration_opened: {
    eventName: "Gala",
    opensAt: "2026-10-12 14:00:00",
    audience: "organiser",
  },
  registration_closed: {
    eventName: "Gala",
    closesAt: "2026-10-12 17:00:00",
    audience: "organiser",
  },
  event_cancellation_requested: { eventName: "Gala" },
  event_cancelled: { audience: "organiser", eventName: "Gala" },
  event_cancellation_declined: { eventName: "Gala", reason: "The deposit is paid." },
  registration_place_freed: { eventName: "Gala", limit: 40, audience: "organiser" },
  event_significant_change: {
    audience: "technical_support",
    eventName: "Gala",
    changedFields: ["proposedDates"],
    actorName: "Alex",
  },
  event_change_processed: { outcome: "applied", eventName: "Gala", whatShouldChange: "Date" },
  venue_block_changed: {
    action: "blocked",
    eventName: "Gala",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: null,
    reason: "Floor resurfacing",
  },
  venue_booking_released_by_coordinator: {
    venueRequestId: "request-1",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    reason: "Released by the Coordinator while Harbour Hall was blocked: Floor resurfacing",
  },
  venue_hold_expiry_changed: {
    venueHoldId: "hold-1",
    venueId: 3,
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    action: "extended",
    expiresAt: "2026-10-10 12:00:00",
    previousExpiresAt: "2026-10-08 12:00:00",
    warnAt: "2026-10-07 09:00:00",
  },
  venue_buffer_conflict: {
    eventName: "Gala",
    venueId: 3,
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    setupMinutes: 30,
    turnaroundMinutes: 30,
  },
  event_submitted: { eventName: "Gala", audience: "organiser" },
  safety_review_requested: { eventName: "Gala" },
  event_safety_reconfirmation_required: { eventName: "Gala" },
  safety_review_decided: {
    eventName: "Gala",
    decision: "changes_requested",
    comments: "Crowd movement needs a second exit.",
  },
  venue_hold_requested: {
    venueHoldId: "hold-1",
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
  },
  venue_hold_placed: {
    venueHoldId: "hold-1",
    venueId: 3,
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    expiresAt: "2026-10-10 12:00:00",
  },
  venue_hold_declined: {
    venueHoldId: "hold-1",
    venueId: 3,
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    reason: "The hall is reserved for exams that week.",
  },
  venue_hold_expiring: {
    venueHoldId: "hold-1",
    venueId: 3,
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    expiresAt: "2026-10-10 12:00:00",
  },
  venue_hold_expired: {
    venueHoldId: "hold-1",
    venueId: 3,
    venueName: "Harbour Hall",
    startsAt: "2026-10-12 14:00:00",
    endsAt: "2026-10-12 17:00:00",
    expiresAt: "2026-10-10 12:00:00",
  },
  coordinator_assigned: {
    eventName: "Gala",
    action: "assign",
    coordinatorName: "Bob",
    audience: "coordinator",
  },
} satisfies Record<(typeof NOTIFICATION_KINDS)[number], unknown>;

/** Parse or fail the test with the kind named. A bad fixture never passes as a silent null. */
function parse(kind: NotificationKind, payload: unknown): NotificationPayload {
  const parsed = parseNotificationPayload(kind, payload);
  if (!parsed) throw new Error(`Expected ${kind} to parse`);
  return parsed;
}

describe("notification payload parsing (PTR-55)", () => {
  it("accepts every kind's payload and rejects a malformed one", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const parsed = parseNotificationPayload(kind, validPayloads[kind]);
      if (!parsed) throw new Error(`${kind} did not parse`);
      expect(parsed.kind).toBe(kind);
    }

    expect(parseNotificationPayload("venue_booking_requested", { venueName: "Harbour Hall" })).toBe(
      null
    );
    expect(parseNotificationPayload("no_such_kind", {})).toBeNull();
  });
});

describe("notification summaries (PTR-55 AC2)", () => {
  it("names the venue for the venue-staff line and never the event", () => {
    const summary = notificationSummary(parse("venue_booking_requested", requestedPayload));
    expect(summary).toBe("Venue booking requested: Harbour Hall");
    expect(summary).not.toContain("Gala");
  });

  it("names the event for the organiser decision line", () => {
    const parsed = parse("event_decided", { eventName: "Gala", decision: "approved" });
    expect(notificationSummary(parsed)).toBe("Your event request for Gala was approved");
  });

  it("names the event for the equipment lines", () => {
    const parsed = parse("equipment_arrangements_completed", { eventName: "Gala", lineCount: 3 });
    expect(notificationSummary(parsed)).toBe("Equipment arrangements complete for Gala");
  });

  it("names the event and the decision for the safety review line (PTR-146)", () => {
    const rejected = parse("safety_review_decided", {
      eventName: "Gala",
      decision: "rejected",
      comments: "The exits cannot take the crowd.",
    });
    expect(notificationSummary(rejected)).toBe("Safety review rejected: Gala");
    expect(notificationHref({ ...rejected, eventRequestId: 7 })).toBe("/events/7");

    const changes = parse("safety_review_decided", validPayloads.safety_review_decided);
    expect(notificationSummary(changes)).toBe("Safety review changes requested: Gala");
  });

  it("reads the released/reduced action from the held quantity", () => {
    const base = {
      eventName: "Gala",
      item: "Projector",
      requestedQuantity: 2,
      previousQuantity: 2,
      arrangementStatus: "requested",
      unavailableReason: null,
      actorName: "Tara",
    };
    const released = parse("equipment_released", { ...base, quantity: 0 });
    const reduced = parse("equipment_released", { ...base, quantity: 1 });
    expect(notificationSummary(released)).toBe("Equipment released for Gala: Projector");
    expect(notificationSummary(reduced)).toBe("Equipment reduced for Gala: Projector");
  });

  it("names the venue for the open-ended and lifted block lines", () => {
    const blocked = parse("venue_block_changed", validPayloads.venue_block_changed);
    expect(notificationSummary(blocked)).toBe("Venue blocked: Harbour Hall");
    const lifted = parse("venue_block_changed", {
      ...validPayloads.venue_block_changed,
      action: "lifted",
      endsAt: "2026-10-12 17:00:00",
    });
    expect(notificationSummary(lifted)).toBe("Venue available again: Harbour Hall");
    expect(notificationHref({ ...lifted, eventRequestId: 7 })).toBe("/events/7");
  });

  it("carries whether a block took the event back to planning, and names the booking a Coordinator released (PTR-137)", () => {
    const reverted = parse("venue_block_changed", {
      ...validPayloads.venue_block_changed,
      revertedToPlanning: true,
    });
    expect(reverted.payload).toMatchObject({ revertedToPlanning: true });
    // A row raised before this story parses as before.
    expect(
      parse("venue_block_changed", validPayloads.venue_block_changed).payload
    ).not.toHaveProperty("revertedToPlanning");

    const released = parse(
      "venue_booking_released_by_coordinator",
      validPayloads.venue_booking_released_by_coordinator
    );
    expect(notificationSummary(released)).toBe(
      "Venue booking released by the Coordinator: Harbour Hall"
    );
    expect(notificationSummary(released)).not.toContain("Gala");
    expect(notificationHref({ ...released, eventRequestId: 7 })).toBe("/venue-bookings");

    // An Attendee's confirmation copy says so; the Organiser's carries no audience.
    const attendee = parse("event_confirmed", {
      ...validPayloads.event_confirmed,
      audience: "attendee",
    });
    expect(attendee.payload).toMatchObject({ audience: "attendee" });
    expect(notificationHref({ ...attendee, eventRequestId: 7 })).toBe("/events/7");
  });

  it("tells each party of an assignment in their own words (PTR-145)", () => {
    const assigned = parse("coordinator_assigned", validPayloads.coordinator_assigned);
    expect(notificationSummary(assigned)).toBe("Event assigned to you: Gala");

    const reassigned = parse("coordinator_assigned", {
      eventName: "Gala",
      action: "reassign",
      coordinatorName: "Bob",
      previousCoordinatorName: "Alice",
      audience: "organiser",
    });
    expect(notificationSummary(reassigned)).toBe("Event Coordinator changed: Gala");
    expect(notificationHref({ ...reassigned, eventRequestId: 7 })).toBe("/events/7");

    const outgoing = parse("coordinator_assigned", {
      eventName: "Gala",
      action: "reassign",
      coordinatorName: "Bob",
      audience: "outgoing_coordinator",
    });
    expect(notificationSummary(outgoing)).toBe("Event reassigned: Gala");
    // The outgoing Coordinator no longer reaches the event, so their copy carries no dead link.
    expect(notificationHref({ ...outgoing, eventRequestId: 7 })).toBeNull();
  });

  it("names the venue, never the event, on the hold request lines (PTR-150)", () => {
    expect(
      notificationSummary(parse("venue_hold_requested", validPayloads.venue_hold_requested))
    ).toBe("Tentative hold requested: Harbour Hall");
    expect(notificationSummary(parse("venue_hold_placed", validPayloads.venue_hold_placed))).toBe(
      "Tentative hold placed: Harbour Hall"
    );
    expect(
      notificationSummary(parse("venue_hold_declined", validPayloads.venue_hold_declined))
    ).toBe("Tentative hold request declined: Harbour Hall");
  });

  it("names the event and venue for the venue buffer conflict line and links to the calendar (PTR-132)", () => {
    const conflict = parse("venue_buffer_conflict", validPayloads.venue_buffer_conflict);
    expect(notificationSummary(conflict)).toBe("Venue buffer conflict: Gala at Harbour Hall");
    expect(notificationHref({ ...conflict, eventRequestId: 7 })).toBe(
      "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12"
    );
    expect(
      parseNotificationPayload("venue_buffer_conflict", {
        ...validPayloads.venue_buffer_conflict,
        venueId: 0,
      })
    ).toBeNull();

    // Several periods link to the calendar over the whole disputed window.
    const spanning = parse("venue_buffer_conflict", {
      ...validPayloads.venue_buffer_conflict,
      periods: [
        { startsAt: "2026-10-12 14:00:00", endsAt: "2026-10-12 15:00:00" },
        { startsAt: "2026-10-14 09:00:00", endsAt: "2026-10-14 10:00:00" },
      ],
    });
    expect(notificationHref({ ...spanning, eventRequestId: 7 })).toBe(
      "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-14"
    );
  });

  it("names the event for the registration lines (PTR-45)", () => {
    expect(notificationSummary(parse("event_registered", validPayloads.event_registered))).toBe(
      "You are registered for Gala"
    );
    expect(
      notificationSummary(
        parse("registration_threshold_reached", validPayloads.registration_threshold_reached)
      )
    ).toBe("Registration is full for Gala");
    expect(
      notificationSummary(
        parse("registration_threshold_reached", {
          ...validPayloads.registration_threshold_reached,
          registered: 36,
        })
      )
    ).toBe("Registration is nearly full for Gala");
    expect(
      notificationSummary(parse("registration_place_freed", validPayloads.registration_place_freed))
    ).toBe("A place has been freed for Gala");
    expect(
      notificationSummary(parse("registration_opened", validPayloads.registration_opened))
    ).toBe("Registration has opened for Gala");
    expect(
      notificationSummary(parse("registration_closed", validPayloads.registration_closed))
    ).toBe("Registration has closed for Gala");
  });

  it("tells the Organiser their request is recorded and the Lead it waits for assignment (PTR-144)", () => {
    const organiser = parse("event_submitted", { eventName: "Gala", audience: "organiser" });
    expect(notificationSummary(organiser)).toBe("Event request submitted: Gala");
    expect(notificationHref({ ...organiser, eventRequestId: 7 })).toBe("/events/7");

    const lead = parse("event_submitted", { eventName: "Gala", audience: "lead" });
    expect(notificationSummary(lead)).toBe("New event request awaiting a Coordinator: Gala");
    expect(notificationHref({ ...lead, eventRequestId: 7 })).toBe("/coordination");

    // A Lead copy of a change or cancellation request opens the queue, not the event page.
    const changeLead = parse("event_change_requested", {
      ...validPayloads.event_change_requested,
      audience: "lead",
    });
    expect(notificationHref({ ...changeLead, eventRequestId: 7 })).toBe("/coordination");
    const cancellationLead = parse("event_cancellation_requested", {
      ...validPayloads.event_cancellation_requested,
      audience: "lead",
    });
    expect(notificationHref({ ...cancellationLead, eventRequestId: 7 })).toBe("/coordination");
    // Rows stored before this story carry no audience and still open the event page.
    expect(
      notificationHref({
        ...parse("event_change_requested", validPayloads.event_change_requested),
        eventRequestId: 7,
      })
    ).toBe("/events/7");
    expect(
      notificationHref({
        ...parse("event_cancellation_requested", validPayloads.event_cancellation_requested),
        eventRequestId: 7,
      })
    ).toBe("/events/7");
  });
});

const hrefFor = (payload: unknown) =>
  notificationHref({ ...parse("event_cancelled", payload), eventRequestId: 7 });

describe("notification hrefs (PTR-55 AC4)", () => {
  const requested = parse("venue_booking_requested", requestedPayload);

  it("points at the event page while the request waits, and the bookings list once approved", () => {
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "pending" })
    ).toBe("/events/7");
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "approved" })
    ).toBe("/venue-bookings");
    // No surface shows a rejected or released request. Those rows carry no link.
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "rejected" })
    ).toBeNull();
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "released" })
    ).toBeNull();
  });

  it("points a retired handover record at the event (PTR-145 AC5)", () => {
    const handover = parse("handover_requested", { eventName: "Gala", fromName: "Alice" });
    expect(notificationHref({ ...handover, eventRequestId: 7 })).toBe("/events/7");
  });

  it("sends each kind to the surface that reads it", () => {
    const replied = parse("clarification_replied", {
      eventName: "Gala",
      question: "q",
      body: "b",
    });
    expect(notificationHref({ ...replied, eventRequestId: 7 })).toBe("/events/7");

    const confirmed = parse("event_confirmed", {
      eventName: "Gala",
      venueName: "Harbour Hall",
      startsAt: "2026-10-12 14:00:00",
      endsAt: "2026-10-12 17:00:00",
      equipment: [],
    });
    expect(notificationHref({ ...confirmed, eventRequestId: 7 })).toBe("/events/7");

    const equipment = parse("equipment_requested", { eventName: "Gala", lines: [] });
    expect(notificationHref({ ...equipment, eventRequestId: 7 })).toBe("/events/7");
  });

  it("sends the capacity notice to the page each recipient reads (PTR-45 AC8)", () => {
    const full = { eventName: "Gala", registered: 40, limit: 40 };
    const organiser = parse("registration_threshold_reached", { ...full, audience: "organiser" });
    const coordinator = parse("registration_threshold_reached", {
      ...full,
      audience: "coordinator",
    });
    expect(notificationHref({ ...organiser, eventRequestId: 7 })).toBe("/events/7");
    expect(notificationHref({ ...coordinator, eventRequestId: 7 })).toBe("/events/7");

    const opened = { eventName: "Gala", opensAt: "2026-10-12 14:00:00" };
    const orgOpened = parse("registration_opened", { ...opened, audience: "organiser" });
    const coordOpened = parse("registration_opened", { ...opened, audience: "coordinator" });
    expect(notificationHref({ ...orgOpened, eventRequestId: 7 })).toBe("/events/7");
    expect(notificationHref({ ...coordOpened, eventRequestId: 7 })).toBe("/events/7");

    const closed = { eventName: "Gala", closesAt: "2026-10-12 17:00:00" };
    const orgClosed = parse("registration_closed", { ...closed, audience: "organiser" });
    const coordClosed = parse("registration_closed", { ...closed, audience: "coordinator" });
    expect(notificationHref({ ...orgClosed, eventRequestId: 7 })).toBe("/events/7");
    expect(notificationHref({ ...coordClosed, eventRequestId: 7 })).toBe("/events/7");
  });

  it("sends the freed place notice to the page each recipient reads (PTR-47 AC4)", () => {
    const freed = { eventName: "Gala", limit: 40 };
    const organiser = parse("registration_place_freed", { ...freed, audience: "organiser" });
    const coordinator = parse("registration_place_freed", {
      ...freed,
      audience: "coordinator",
    });
    expect(notificationHref({ ...organiser, eventRequestId: 7 })).toBe("/events/7");
    expect(notificationHref({ ...coordinator, eventRequestId: 7 })).toBe("/events/7");
  });

  it("sends each party told of a cancellation to the surface they act on (PTR-54)", () => {
    expect(hrefFor({ audience: "attendee", eventName: "Gala" })).toBe("/events/7");
    expect(hrefFor({ audience: "technical_support", eventName: "Gala" })).toBe("/events/7");
    expect(
      hrefFor({
        audience: "venue_staff",
        venueName: "Hall A",
        startsAt: "2026-10-12 09:00:00",
        endsAt: "2026-10-12 17:00:00",
      })
    ).toBe("/venue-bookings");
  });

  it("refuses a Venue Staff cancellation that carries no booking (PTR-54)", () => {
    expect(
      parseNotificationPayload("event_cancelled", { audience: "venue_staff", eventName: "Gala" })
    ).toBeNull();
  });

  it("tells the Organiser the outcome of a change request, with the reason for a decline (PTR-52 AC5)", () => {
    const applied = parse("event_change_processed", validPayloads.event_change_processed);
    expect(notificationSummary(applied)).toBe("Change request applied: Gala");
    expect(notificationHref({ ...applied, eventRequestId: 7 })).toBe("/events/7");

    const declined = parse("event_change_processed", {
      outcome: "declined",
      eventName: "Gala",
      whatShouldChange: "Date",
      reason: "The venue is only free that day.",
    });
    expect(notificationSummary(declined)).toBe("Change request declined: Gala");
    // A decline without its reason is malformed.
    expect(
      parseNotificationPayload("event_change_processed", {
        outcome: "declined",
        eventName: "Gala",
        whatShouldChange: "Date",
      })
    ).toBeNull();
  });

  it("names the booking to Venue Staff and the event to Technical Support for a significant change, and refuses an ordinary field (PTR-23 AC5)", () => {
    const venue = parse("event_significant_change", {
      audience: "venue_staff",
      venueName: "Harbour Hall",
      startsAt: "2026-10-12 14:00:00",
      endsAt: "2026-10-12 17:00:00",
      changedFields: ["proposedDates", "expectedAttendance"],
      actorName: "Alex",
    });
    expect(notificationSummary(venue)).toBe(
      "Event details changed for the booking at Harbour Hall"
    );
    expect(notificationSummary(venue)).not.toContain("Gala");
    expect(notificationHref({ ...venue, eventRequestId: 7 })).toBe("/venue-bookings");

    const tech = parse("event_significant_change", validPayloads.event_significant_change);
    expect(notificationSummary(tech)).toBe("Event details changed: Gala");
    expect(notificationHref({ ...tech, eventRequestId: 7 })).toBe("/events/7");

    for (const changedFields of [[], ["purpose"]]) {
      expect(
        parseNotificationPayload("event_significant_change", {
          ...validPayloads.event_significant_change,
          changedFields,
        })
      ).toBeNull();
    }
  });

  it("summarises a hold expiry change by action and venue, and rejects an unknown action (PTR-142)", () => {
    const changed = parse("venue_hold_expiry_changed", validPayloads.venue_hold_expiry_changed);
    expect(notificationSummary(changed)).toBe("Tentative hold expiry extended: Harbour Hall");
    expect(
      parseNotificationPayload("venue_hold_expiry_changed", {
        ...validPayloads.venue_hold_expiry_changed,
        action: "removed",
      })
    ).toBeNull();
    // A hold that ends on a later day links to the calendar for both days.
    const overnight = parse("venue_hold_expiry_changed", {
      ...validPayloads.venue_hold_expiry_changed,
      endsAt: "2026-10-13 02:00:00",
    });
    expect(notificationHref({ ...overnight, eventRequestId: 7 })).toBe(
      "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-13"
    );
  });

  it("summarises a hold warning and an expired hold with their venues (PTR-143)", () => {
    expect(
      notificationSummary(parse("venue_hold_expiring", validPayloads.venue_hold_expiring))
    ).toBe("Tentative hold expires soon: Harbour Hall");
    expect(notificationSummary(parse("venue_hold_expired", validPayloads.venue_hold_expired))).toBe(
      "Tentative hold expired: Harbour Hall"
    );
  });

  it("sends every kind to its default surface with no facts", () => {
    const expected: Record<NotificationKind, string | null> = {
      venue_booking_requested: null,
      handover_requested: "/events/7",
      clarification_requested: "/events/7",
      handover_accepted: "/events/7",
      event_decided: "/events/7",
      event_confirmed: "/events/7",
      venue_booking_approved: "/events/7",
      venue_booking_rejected: "/events/7",
      venue_booking_changed: "/events/7",
      clarification_replied: "/events/7",
      event_change_requested: "/events/7",
      handover_declined: "/events/7",
      equipment_arrangements_completed: "/events/7",
      equipment_unavailable: "/events/7",
      equipment_released: "/events/7",
      equipment_requested: "/events/7",
      event_registered: "/events/7",
      registration_threshold_reached: "/events/7",
      registration_opened: "/events/7",
      registration_closed: "/events/7",
      event_cancellation_requested: "/events/7",
      event_cancelled: "/events/7",
      event_cancellation_declined: "/events/7",
      registration_place_freed: "/events/7",
      event_significant_change: "/events/7",
      event_change_processed: "/events/7",
      venue_block_changed: "/events/7",
      venue_booking_released_by_coordinator: "/venue-bookings",
      venue_hold_expiry_changed:
        "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12",
      venue_buffer_conflict:
        "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12",
      event_submitted: "/events/7",
      safety_review_requested: "/events/7",
      event_safety_reconfirmation_required: "/events/7",
      safety_review_decided: "/events/7",
      venue_hold_requested: "/venue-holds",
      venue_hold_placed: "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12",
      venue_hold_declined: "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12",
      venue_hold_expiring: "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12",
      venue_hold_expired: "/venues/availability?venueId=3&startDate=2026-10-12&endDate=2026-10-12",
      coordinator_assigned: "/events/7",
    };

    for (const kind of NOTIFICATION_KINDS) {
      const parsed = parseNotificationPayload(kind, validPayloads[kind]);
      if (!parsed) throw new Error(`Expected ${kind} to parse`);
      const href = notificationHref({ ...parsed, eventRequestId: 7 });
      if (href !== expected[kind]) {
        throw new Error(`Expected ${kind} href to be ${expected[kind]}, got ${href}`);
      }
    }
    // The map covers every kind. A kind added with no arm fails here.
    expect(Object.keys(expected).toSorted()).toEqual([...NOTIFICATION_KINDS].toSorted());
  });
});

describe("notification reachability (PTR-55 AC5)", () => {
  const confirmed = parse("event_confirmed", validPayloads.event_confirmed);

  it("neutralises rows whose event is out of reach", () => {
    expect(notificationReachable(confirmed, { eventAccessible: false })).toBe(false);
    expect(notificationReachable(confirmed, { eventAccessible: true })).toBe(true);
  });

  it("keeps every retired handover record readable without an event relation (PTR-145 AC5)", () => {
    for (const kind of ["handover_requested", "handover_accepted", "handover_declined"] as const) {
      expect(
        notificationReachable(parse(kind, validPayloads[kind]), { eventAccessible: false })
      ).toBe(true);
    }
  });

  it("keeps the Coordinator parties' assignment notices readable (PTR-145 AC1, AC2)", () => {
    const outgoing = parse("coordinator_assigned", {
      eventName: "Gala",
      action: "reassign",
      coordinatorName: "Bob",
      audience: "outgoing_coordinator",
    });
    expect(notificationReachable(outgoing, { eventAccessible: false })).toBe(true);

    const incoming = parse("coordinator_assigned", validPayloads.coordinator_assigned);
    expect(notificationReachable(incoming, { eventAccessible: false })).toBe(true);
    expect(notificationReachable(incoming, { eventAccessible: true })).toBe(true);

    // The Organiser always reaches the event; that relationship is the rule.
    const organiser = parse("coordinator_assigned", {
      eventName: "Gala",
      action: "assign",
      coordinatorName: "Bob",
      audience: "organiser",
    });
    expect(notificationReachable(organiser, { eventAccessible: false })).toBe(false);
    expect(notificationReachable(organiser, { eventAccessible: true })).toBe(true);
  });

  it("keeps a hold request visible to Venue Staff without an event relation (PTR-150)", () => {
    // The shared queue reaches every Venue Staff member. The payload names no event.
    const requested = parse("venue_hold_requested", validPayloads.venue_hold_requested);
    expect(notificationReachable(requested, { eventAccessible: false })).toBe(true);
    const declined = parse("venue_hold_declined", validPayloads.venue_hold_declined);
    expect(notificationReachable(declined, { eventAccessible: false })).toBe(false);
  });

  it("rides the event relationship for the hold warning and the expiry (PTR-143)", () => {
    for (const kind of ["venue_hold_expiring", "venue_hold_expired"] as const) {
      const payload = parse(kind, validPayloads[kind]);
      expect(notificationReachable(payload, { eventAccessible: false })).toBe(false);
      expect(notificationReachable(payload, { eventAccessible: true })).toBe(true);
    }
  });

  it("opens the event page for the safety decision (PTR-146)", () => {
    // The assigned Coordinator and every Lead (PTR-144) reach a non-draft event, so the decision
    // rides the ordinary event relationship.
    const decision = parse("safety_review_decided", validPayloads.safety_review_decided);
    expect(notificationHref({ ...decision, eventRequestId: 7 })).toBe("/events/7");
    expect(notificationReachable(decision, { eventAccessible: true })).toBe(true);
    expect(notificationReachable(decision, { eventAccessible: false })).toBe(false);
  });
});
