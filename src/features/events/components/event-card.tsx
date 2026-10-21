import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatEntryPeriod, formatLocalDate } from "#/features/event-requests/format";
import type { EventProjection } from "#/features/events/access";
import { hasAttendeePage } from "#/features/events/access";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";

/**
 * Title an event on the card and the event page the same way. Venue Staff never see the event
 * name (PTR-31 AC2), so they see the distinct venues of their requests, in list order.
 */
export function eventTitle(projection: EventProjection): string {
  const { access, event } = projection;
  if (access === "venue_staff") {
    const venueNames = [...new Set((event.venueRequests ?? []).map(entry => entry.venueName))];
    return venueNames.length > 0 ? venueNames.join(", ") : "Venue request";
  }
  return event.name ?? "Untitled event";
}

/**
 * Show one dashboard card per connected event. It carries the access, the stage, the name as the
 * only link, and the date and time. A Venue Staff card lists each request with its venue, period
 * and state instead of the event's proposed date (PTR-138 AC5). The card surface itself is not
 * clickable.
 */
export function EventCard({ event: projection }: { event: EventProjection }) {
  const { access, event } = projection;
  const title = eventTitle(projection);
  const canOpen = access !== "attendee" || hasAttendeePage(event);

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-muted-foreground">{access.replaceAll("_", " ")} access</p>
            <h2 className="mt-2 display-h3">
              {canOpen ? (
                <Link
                  to="/events/$eventId"
                  params={{ eventId: String(event.id) }}
                  className="underline decoration-foreground/60 underline-offset-4 hover:decoration-foreground"
                >
                  {title}
                </Link>
              ) : (
                title
              )}
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <EventRequestStatusBadge status={event.status} />
            {access === "attendee" && event.registration?.status === "registered" && (
              <Badge variant="outline" aria-label="Your registration: Registered">
                Registered
              </Badge>
            )}
            {access === "attendee" && event.registration?.status === "waitlisted" && (
              <Badge variant="outline" aria-label="Your registration: Waiting list">
                Waiting list
              </Badge>
            )}
          </div>
        </div>

        {event.description && (
          <p className="mt-4 body-sm text-muted-foreground">{event.description}</p>
        )}
        {access === "venue_staff" ? (
          <ul
            className="mt-5 grid gap-3 body-sm text-muted-foreground"
            aria-label="Booking requests"
          >
            {(event.venueRequests ?? []).map(entry => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-medium text-foreground">{entry.venueName}</span>
                <span className="flex items-center gap-2">
                  <CalendarDays className="size-4" />
                  {formatEntryPeriod(entry)}
                </span>
                <VenueRequestStatusBadge status={entry.status} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-5 grid gap-3 body-sm text-muted-foreground sm:grid-cols-2">
            {event.eventDate && (
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4" />
                {formatLocalDate(event.eventDate)}
              </span>
            )}
            {event.startTime && event.endTime && (
              <span className="flex items-center gap-2">
                <Clock3 className="size-4" />
                {event.startTime}–{event.endTime}
              </span>
            )}
          </div>
        )}

        {access === "attendee" && !canOpen && (
          <p className="mt-4 body-sm text-muted-foreground">
            {event.status === "completed"
              ? "This event has ended."
              : "The event page opens once this event is confirmed."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
