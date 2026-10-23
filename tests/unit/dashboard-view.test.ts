import { describe, expect, it } from "vitest";

import type { AssignedEventRequest } from "#/features/coordination/server-fns";
import type { DashboardData } from "#/features/dashboard/dashboard-view";
import { dashboardView } from "#/features/dashboard/dashboard-view";
import type {
  EventRequestSummary,
  UnassignedEventRequest,
} from "#/features/event-requests/server-fns";
import type { EventProjection } from "#/features/events/access";
import type { PendingSafetyReview } from "#/features/safety-reviews/schema";
import type { VenueBooking, VenueHoldRequest } from "#/features/venue-requests/server-fns";

function projection(id: number, equipment: { arrangeable?: boolean }[] = []): EventProjection {
  return {
    access: "technical_support",
    event: {
      id,
      status: "submitted",
      eventDate: "2026-10-05",
      startTime: "09:00",
      endTime: "17:00",
      equipment: equipment.map((line, index) => ({
        id: `line-${index}`,
        item: "Projector",
        quantity: 1,
        arrangementStatus: "requested",
        notes: null,
        ...line,
      })),
    },
  };
}

function assigned(status: string, changeRequestsWaiting = 0): AssignedEventRequest {
  return { status, changeRequestsWaiting } as AssignedEventRequest;
}

function base(role: DashboardData["role"]): DashboardData {
  return { role, events: [projection(7), projection(12)] };
}

function draft(status: string): EventRequestSummary {
  return { status } as EventRequestSummary;
}

describe("dashboardView", () => {
  it("gives the organiser their events, a new-request action, and the draft count", () => {
    const view = dashboardView({
      ...base("event_organiser"),
      drafts: [draft("draft"), draft("draft")],
    });

    expect(view.title).toBe("Your events");
    expect(view.primaryAction).toEqual({ label: "New request", href: "/event-requests/new" });
    expect(view.groups).toEqual([{ title: "Drafts", count: 2, href: "/event-requests" }]);
    expect(view.empty).toBeNull();
  });

  it("counts drafts only, not every request the organiser made", () => {
    const view = dashboardView({
      ...base("event_organiser"),
      drafts: [draft("draft"), draft("submitted"), draft("approved"), draft("draft")],
    });

    expect(view.groups).toEqual([{ title: "Drafts", count: 2, href: "/event-requests" }]);
    expect(view.empty).toBeNull();
  });

  it("empties the organiser dashboard with a role-aware empty state", () => {
    const view = dashboardView({
      role: "event_organiser",
      events: [],
      drafts: [draft("submitted")],
    });

    expect(view.empty?.title).toBe("No events yet");
    expect(view.primaryAction?.label).toBe("New request");
  });

  it("counts the coordinator's active assignments and waiting change requests", () => {
    const view = dashboardView({
      ...base("event_coordinator"),
      assignedRequests: [
        assigned("submitted", 2),
        assigned("under_review"),
        assigned("approved"),
        assigned("awaiting_organiser", 1),
      ],
    });

    expect(view.title).toBe("Your coordination work");
    expect(view.primaryAction).toEqual({ label: "Open coordination queue", href: "/coordination" });
    expect(view.groups).toEqual([
      { title: "Needs your review", count: 2, href: "/coordination" },
      { title: "Change requests", count: 3, href: "/coordination" },
    ]);
    expect(view.empty).toBeNull();
  });

  it("empties the coordinator queue when nothing waits", () => {
    const view = dashboardView({
      role: "event_coordinator",
      events: [],
      assignedRequests: [assigned("approved")],
    });

    expect(view.groups).toEqual([]);
    expect(view.empty?.title).toBe("Nothing to coordinate");
  });

  it("counts the lead's unassigned queue and links to coordination", () => {
    const view = dashboardView({
      ...base("event_coordinator_lead"),
      unassignedRequests: [{}, {}, {}] as UnassignedEventRequest[],
    });

    expect(view.title).toBe("Coordination overview");
    expect(view.primaryAction).toEqual({ label: "Open coordination queue", href: "/coordination" });
    expect(view.groups).toEqual([
      { title: "Unassigned requests", count: 3, href: "/coordination" },
    ]);
    expect(view.empty).toBeNull();
  });

  it("clears the lead queue when every request has a coordinator", () => {
    const view = dashboardView({
      role: "event_coordinator_lead",
      events: [],
      unassignedRequests: [],
    });

    expect(view.groups).toEqual([]);
    expect(view.empty?.title).toBe("Queue is clear");
  });

  it("counts the venue staff booking and hold queues", () => {
    const view = dashboardView({
      ...base("venue_staff"),
      bookings: [{}, {}] as VenueBooking[],
      holds: [{}] as VenueHoldRequest[],
    });

    expect(view.title).toBe("Venue operations");
    expect(view.primaryAction).toEqual({ label: "Open booking queue", href: "/venue-bookings" });
    expect(view.groups).toEqual([
      { title: "Upcoming bookings", count: 2, href: "/venue-bookings" },
      { title: "Hold requests", count: 1, href: "/venue-holds" },
    ]);
    expect(view.empty).toBeNull();
  });

  it("empties the venue staff queues together", () => {
    const view = dashboardView({ role: "venue_staff", events: [], bookings: [], holds: [] });

    expect(view.groups).toEqual([]);
    expect(view.empty?.title).toBe("No venue work");
  });

  it("counts the technical support arrangeable lines and links to the first event", () => {
    const view = dashboardView({
      role: "technical_support_staff",
      events: [projection(7, [{ arrangeable: true }, {}]), projection(12, [{ arrangeable: true }])],
    });

    expect(view.title).toBe("Equipment work");
    expect(view.primaryAction).toEqual({ label: "Open first event", href: "/events/7" });
    expect(view.groups).toEqual([{ title: "Lines to arrange", count: 2, href: "/events/7" }]);
    expect(view.empty).toBeNull();
  });

  it("empties the technical support list with no action when there are no events", () => {
    const view = dashboardView({ role: "technical_support_staff", events: [] });

    expect(view.primaryAction).toBeNull();
    expect(view.groups).toEqual([]);
    expect(view.empty?.title).toBe("No equipment work");
  });

  it("counts the safety officer's pending reviews", () => {
    const view = dashboardView({
      ...base("safety_officer"),
      safetyReviews: [{}, {}] as PendingSafetyReview[],
    });

    expect(view.title).toBe("Safety reviews");
    expect(view.primaryAction).toEqual({ label: "Open safety reviews", href: "/safety-reviews" });
    expect(view.groups).toEqual([{ title: "Pending reviews", count: 2, href: "/safety-reviews" }]);
    expect(view.empty).toBeNull();
  });

  it("empties the safety officer list when no review waits", () => {
    const view = dashboardView({ role: "safety_officer", events: [], safetyReviews: [] });

    expect(view.empty?.title).toBe("No safety reviews");
  });

  it("gives the attendee their events with no staff actions", () => {
    const view = dashboardView(base("attendee"));

    expect(view.title).toBe("Your events");
    expect(view.primaryAction).toBeNull();
    expect(view.groups).toEqual([]);
    expect(view.empty).toBeNull();
  });

  it("empties the attendee list without offering a staff action", () => {
    const view = dashboardView({ role: "attendee", events: [] });

    expect(view.empty?.title).toBe("No events yet");
    expect(view.primaryAction).toBeNull();
  });
});
