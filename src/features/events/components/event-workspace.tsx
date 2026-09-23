import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import type { EventProjection } from "#/features/events/access";
import { EventRequirements } from "#/features/events/components/event-requirements";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`)
  );
}

/**
 * The dashboard's "Your connected events" widget. Its data arrives from the dashboard loader,
 * which calls the `listEvents` server function, so this view renders what the caller is allowed
 * to see rather than fetching anything itself.
 */
export function EventWorkspace({ events }: { events: EventProjection[] }) {
  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="event-workspace-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-muted-foreground">Workspace</p>
          <h2 id="event-workspace-title" className="mt-2 display-h3">
            Your connected events
          </h2>
        </div>
        {events[0] && (
          <span className="body-sm text-muted-foreground">
            Access filtered by your relationship
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-6 body-sm text-muted-foreground">
          No events are currently connected to your account.
        </p>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {events.map(({ access, event }) => (
            <Card key={event.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow text-muted-foreground">
                      {access.replaceAll("_", " ")} access
                    </p>
                    <h3 className="mt-2 display-h3">{event.name ?? "Venue request"}</h3>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <EventRequestStatusBadge status={event.status} />
                    {event.registration?.status && (
                      <Badge variant="confirmed">{event.registration.status}</Badge>
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
                      {formatDate(event.eventDate)}
                    </span>
                  )}
                  {event.startTime && event.endTime && (
                    <span className="flex items-center gap-2">
                      <Clock3 className="size-4" />
                      {event.startTime}–{event.endTime}
                    </span>
                  )}
                </div>

                {(access === "venue_staff" ||
                  access === "organiser" ||
                  access === "coordinator") && (
                  <EventRequirements
                    event={event}
                    className="mt-5 border-t border-border pt-4 body-sm"
                  >
                    {event.venueRequest && (
                      <Detail
                        label="Venue request"
                        value={
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge variant="progress">Pending</Badge>
                            {event.venueRequest.conflict && (
                              <Badge variant="stopped">Conflicting booking</Badge>
                            )}
                          </span>
                        }
                      />
                    )}
                  </EventRequirements>
                )}

                {event.equipment && event.equipment.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <p className="body-sm font-medium">Equipment arrangements</p>
                    <ul className="mt-3 space-y-2 body-sm text-muted-foreground">
                      {event.equipment.map(item => (
                        <li key={item.id} className="flex justify-between gap-4">
                          <span>{item.item}</span>
                          <span className="capitalize">{item.arrangementStatus}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {access === "coordinator" && SEARCHABLE_EVENT_STATUSES.includes(event.status) && (
                  <div className="mt-5 border-t border-border pt-4">
                    <Link
                      to="/venues"
                      search={{ eventId: event.id }}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Find venues for this event
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/** The one extra row a card adds beside the shared requirements: its pending request. */
function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}
