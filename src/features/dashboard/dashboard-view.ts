import type { Role } from "#/features/auth/schema/role";
import type { AssignedEventRequest } from "#/features/coordination/server-fns";
import type {
  EventRequestSummary,
  UnassignedEventRequest,
} from "#/features/event-requests/server-fns";
import type { EventProjection } from "#/features/events/access";
import type { PendingSafetyReview } from "#/features/safety-reviews/schema";
import type { VenueBooking, VenueHoldRequest } from "#/features/venue-requests/server-fns";

/**
 * Everything the role dashboards render, loaded by the route from the existing server
 * functions. Each optional list only travels for the role that reads it, so no new
 * server function is needed.
 */
export interface DashboardData {
  role: Role;
  events: EventProjection[];
  /** Safety Officer only, from `listSafetyReviews`. */
  safetyReviews?: PendingSafetyReview[];
  /** Venue Staff only, from `listVenueBookings`. Already limited to upcoming approved rows. */
  bookings?: VenueBooking[];
  /** Venue Staff only, from `listVenueHoldRequests`. Already limited to requested rows. */
  holds?: VenueHoldRequest[];
  /** Organiser only, from `listEventRequests`. Holds every request, not drafts alone. */
  drafts?: EventRequestSummary[];
  /** Coordinator only, from `listAssignedEventRequests`. */
  assignedRequests?: AssignedEventRequest[];
  /** Lead only, from `listUnassignedEventRequests`. */
  unassignedRequests?: UnassignedEventRequest[];
}

export interface DashboardAction {
  label: string;
  href: string;
}

export interface DashboardGroup {
  title: string;
  count: number;
  href: string;
}

export interface DashboardView {
  title: string;
  description: string;
  primaryAction: DashboardAction | null;
  groups: DashboardGroup[];
  empty: { title: string; description: string } | null;
}

/** The requests still waiting on the Coordinator: submitted or under review. */
function activeAssignedCount(data: DashboardData): number {
  return (data.assignedRequests ?? []).filter(
    request => request.status === "submitted" || request.status === "under_review"
  ).length;
}

/** The Organiser change requests still waiting on the Coordinator, summed across rows. */
function changeRequestCount(data: DashboardData): number {
  return (data.assignedRequests ?? []).reduce(
    (total, request) => total + request.changeRequestsWaiting,
    0
  );
}

/** The equipment lines the signed-in Technical Support member can act on now. */
function arrangeableLineCount(data: DashboardData): number {
  return data.events
    .flatMap(projection => projection.event.equipment ?? [])
    .filter(line => line.arrangeable === true).length;
}

/**
 * The role-aware dashboard copy and actions. Pure: routes feed the loader data
 * and the page renders what comes back. Empty lists yield an empty state instead of counts.
 */
export function dashboardView(data: DashboardData): DashboardView {
  const events = data.events.length;

  switch (data.role) {
    case "event_organiser": {
      const drafts = (data.drafts ?? []).filter(request => request.status === "draft").length;
      return {
        title: "Your events",
        description: "Requests you made and their progress.",
        primaryAction: { label: "New request", href: "/event-requests/new" },
        groups: drafts > 0 ? [{ title: "Drafts", count: drafts, href: "/event-requests" }] : [],
        empty:
          events === 0 && drafts === 0
            ? {
                title: "No events yet",
                description: "Start your first request to see it here.",
              }
            : null,
      };
    }

    case "event_coordinator": {
      const active = activeAssignedCount(data);
      const changes = changeRequestCount(data);
      const actionable = active + changes;
      const groups: DashboardGroup[] = [];
      if (active > 0)
        groups.push({ title: "Needs your review", count: active, href: "/coordination" });
      if (changes > 0)
        groups.push({ title: "Change requests", count: changes, href: "/coordination" });
      return {
        title: "Your coordination work",
        description: "Requests assigned to you and their status.",
        primaryAction: { label: "Open coordination queue", href: "/coordination" },
        groups,
        empty:
          actionable === 0
            ? {
                title: "Nothing to coordinate",
                description: "New assignments will appear here.",
              }
            : null,
      };
    }

    case "event_coordinator_lead": {
      const unassigned = data.unassignedRequests?.length ?? 0;
      return {
        title: "Coordination overview",
        description: "Requests waiting for a coordinator.",
        primaryAction: { label: "Open coordination queue", href: "/coordination" },
        groups:
          unassigned > 0
            ? [{ title: "Unassigned requests", count: unassigned, href: "/coordination" }]
            : [],
        empty:
          unassigned === 0
            ? {
                title: "Queue is clear",
                description: "Every request has a coordinator.",
              }
            : null,
      };
    }

    case "venue_staff": {
      const bookings = data.bookings?.length ?? 0;
      const holds = data.holds?.length ?? 0;
      const actionable = bookings + holds;
      const groups: DashboardGroup[] = [];
      if (bookings > 0)
        groups.push({ title: "Upcoming bookings", count: bookings, href: "/venue-bookings" });
      if (holds > 0) groups.push({ title: "Hold requests", count: holds, href: "/venue-holds" });
      return {
        title: "Venue operations",
        description: "Bookings on your venues and holds waiting for a decision.",
        primaryAction: { label: "Open booking queue", href: "/venue-bookings" },
        groups,
        empty:
          actionable === 0
            ? {
                title: "No venue work",
                description: "New bookings and hold requests will appear here.",
              }
            : null,
      };
    }

    case "technical_support_staff": {
      const actionable = arrangeableLineCount(data);
      const firstEvent = data.events.length > 0 ? data.events[0] : undefined;
      return {
        title: "Equipment work",
        description: "Lines across your events that still need arranging.",
        primaryAction:
          firstEvent === undefined
            ? null
            : { label: "Open first event", href: `/events/${firstEvent.event.id}` },
        groups:
          actionable > 0 && firstEvent !== undefined
            ? [
                {
                  title: "Lines to arrange",
                  count: actionable,
                  href: `/events/${firstEvent.event.id}`,
                },
              ]
            : [],
        empty:
          actionable === 0
            ? {
                title: "No equipment work",
                description: "New lines to arrange will appear here.",
              }
            : null,
      };
    }

    case "safety_officer": {
      const pending = data.safetyReviews?.length ?? 0;
      return {
        title: "Safety reviews",
        description: "Events waiting for your safety decision.",
        primaryAction: { label: "Open safety reviews", href: "/safety-reviews" },
        groups:
          pending > 0
            ? [{ title: "Pending reviews", count: pending, href: "/safety-reviews" }]
            : [],
        empty:
          pending === 0
            ? {
                title: "No safety reviews",
                description: "New reviews will appear here when arrangements complete.",
              }
            : null,
      };
    }

    case "attendee":
    default:
      return {
        title: "Your events",
        description: "Events you registered for.",
        primaryAction: null,
        groups: [],
        empty:
          events === 0
            ? {
                title: "No events yet",
                description: "Events you register for will appear here.",
              }
            : null,
      };
  }
}
