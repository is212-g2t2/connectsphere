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
} satisfies Record<(typeof NOTIFICATION_KINDS)[number], unknown>;

/** Parses or fails the test with the kind named, so a bad fixture is not a silent null. */
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
});

describe("notification hrefs (PTR-55 AC4)", () => {
  const requested = parse("venue_booking_requested", requestedPayload);

  it("points at the pending detail while the request waits, and the bookings list once approved", () => {
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "pending" })
    ).toBe("/venue-requests/request-1");
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "approved" })
    ).toBe("/venue-bookings");
    // No surface still shows a rejected or released request, so those rows carry no link.
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "rejected" })
    ).toBeNull();
    expect(
      notificationHref({ ...requested, eventRequestId: 7 }, { venueRequestStatus: "released" })
    ).toBeNull();
  });

  it("sends the not-yet-assigned Coordinator to the coordination dashboard", () => {
    const handover = parse("handover_requested", { eventName: "Gala", fromName: "Alice" });
    expect(notificationHref({ ...handover, eventRequestId: 7 }, { handoverPending: true })).toBe(
      "/coordination"
    );
    expect(notificationHref({ ...handover, eventRequestId: 7 })).toBe("/coordination/7");
  });

  it("sends each kind to the surface that reads it", () => {
    const replied = parse("clarification_replied", {
      eventName: "Gala",
      question: "q",
      body: "b",
    });
    expect(notificationHref({ ...replied, eventRequestId: 7 })).toBe("/coordination/7");

    const confirmed = parse("event_confirmed", {
      eventName: "Gala",
      venueName: "Harbour Hall",
      startsAt: "2026-10-12 14:00:00",
      endsAt: "2026-10-12 17:00:00",
      equipment: [],
    });
    expect(notificationHref({ ...confirmed, eventRequestId: 7 })).toBe("/event-requests/7");

    const equipment = parse("equipment_requested", { eventName: "Gala", lines: [] });
    expect(notificationHref({ ...equipment, eventRequestId: 7 })).toBe("/equipment-requests/7");
  });

  it("sends every kind to its default surface with no facts", () => {
    const expected: Record<NotificationKind, string | null> = {
      venue_booking_requested: null,
      handover_requested: "/coordination/7",
      clarification_requested: "/event-requests/7",
      handover_accepted: "/event-requests/7",
      event_decided: "/event-requests/7",
      event_confirmed: "/event-requests/7",
      venue_booking_approved: "/coordination/7",
      venue_booking_rejected: "/coordination/7",
      venue_booking_changed: "/coordination/7",
      clarification_replied: "/coordination/7",
      handover_declined: "/coordination/7",
      equipment_arrangements_completed: "/coordination/7",
      equipment_unavailable: "/coordination/7",
      equipment_released: "/coordination/7",
      equipment_requested: "/equipment-requests/7",
    };

    for (const kind of NOTIFICATION_KINDS) {
      const parsed = parseNotificationPayload(kind, validPayloads[kind]);
      if (!parsed) throw new Error(`Expected ${kind} to parse`);
      const href = notificationHref({ ...parsed, eventRequestId: 7 });
      if (href !== expected[kind]) {
        throw new Error(`Expected ${kind} href to be ${expected[kind]}, got ${href}`);
      }
    }
    // The map must cover every kind: a kind added without an arm fails here.
    expect(Object.keys(expected).toSorted()).toEqual([...NOTIFICATION_KINDS].toSorted());
  });
});

describe("notification reachability (PTR-55 AC5)", () => {
  it("neutralises rows whose event is out of reach", () => {
    expect(
      notificationReachable("event_confirmed", { eventAccessible: false, handoverPending: false })
    ).toBe(false);
    expect(
      notificationReachable("event_confirmed", { eventAccessible: true, handoverPending: false })
    ).toBe(true);
  });

  it("keeps a live handover offer visible before the recipient is assigned", () => {
    expect(
      notificationReachable("handover_requested", {
        eventAccessible: false,
        handoverPending: true,
      })
    ).toBe(true);
    expect(
      notificationReachable("handover_requested", {
        eventAccessible: false,
        handoverPending: false,
      })
    ).toBe(false);
  });
});
