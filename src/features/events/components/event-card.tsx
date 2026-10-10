import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatLocalDate } from "#/features/event-requests/format";
import type { EventProjection } from "#/features/events/access";
import { hasAttendeePage } from "#/features/events/access";

/** The card and the event page title an event the same way: venue staff see the venue. */
export function eventTitle(projection: EventProjection): string {
  const { access, event } = projection;
  if (access === "venue_staff") return event.venueRequest?.venueName ?? "Venue request";
  return event.name ?? "Untitled event";
}

/**
 * The dashboard's one card per connected event: whose access it is, the event's stage, its name
 * as the only link, and its date and time. The card surface itself is not clickable.
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
          </div>
        </div>

        {event.description && (
          <p className="mt-4 body-sm text-muted-foreground">{event.description}</p>
        )}
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
