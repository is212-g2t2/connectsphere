import type { EventProjection } from "#/features/events/access";

/**
 * Title an event on the dashboard row and the event page the same way. Venue Staff never see the
 * event name (PTR-31 AC2), so they see the distinct venues of their requests, in list order. Two
 * callers share it (the dashboard row and the event detail page), so it keeps its own module.
 */
export function eventTitle(projection: EventProjection): string {
  const { access, event } = projection;
  if (access === "venue_staff") {
    const venueNames = [...new Set((event.venueRequests ?? []).map(entry => entry.venueName))];
    return venueNames.length > 0 ? venueNames.join(", ") : "Venue request";
  }
  return event.name ?? "Untitled event";
}
