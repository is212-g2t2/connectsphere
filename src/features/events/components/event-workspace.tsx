import { CalendarDays, Clock3, MapPin, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { EventResponse } from "#/features/events/types";

type LoadState = "loading" | "ready" | "empty" | "forbidden" | "error";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(`${value}T00:00:00`)
  );
}

function roleLabel(access: EventResponse["access"]) {
  return access.replaceAll("_", " ");
}

export function EventWorkspace() {
  const [events, setEvents] = useState<EventResponse[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/events")
      .then(async response => {
        if (response.status === 403) {
          if (!cancelled) setState("forbidden");
          return { events: [] as EventResponse[], forbidden: true };
        }
        if (!response.ok) throw new Error("Unable to load events");
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const payload = (await response.json()) as { events: EventResponse[] };
        return { ...payload, forbidden: false };
      })
      .then(result => {
        if (cancelled || result.forbidden) return result;
        setEvents(result.events);
        setState(result.events.length > 0 ? "ready" : "empty");
        return result;
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="event-workspace-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Workspace
          </p>
          <h2 id="event-workspace-title" className="font-heading mt-2 text-2xl font-semibold">
            Your connected events
          </h2>
        </div>
        {events[0] && (
          <span className="text-xs text-muted-foreground">
            Access filtered by your relationship
          </span>
        )}
      </div>

      {state === "loading" && <p className="mt-6 text-sm text-muted-foreground">Loading events…</p>}
      {state === "empty" && (
        <p className="mt-6 text-sm text-muted-foreground">
          No events are currently connected to your account.
        </p>
      )}
      {state === "forbidden" && <WorkspaceMessage text="You do not have access to these events." />}
      {state === "error" && (
        <WorkspaceMessage text="Events could not be loaded. Try refreshing the page." />
      )}
      {state === "ready" && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {events.map(({ access, event }) => (
            <article key={event.id} className="rounded-xl bg-card p-6 shadow-xs ring-1 ring-border">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
                    {roleLabel(access)} access
                  </p>
                  <h3 className="font-heading mt-2 text-xl font-semibold">{event.name}</h3>
                </div>
                {event.registration?.status && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    {event.registration.status}
                  </span>
                )}
              </div>

              {event.description && (
                <p className="mt-4 text-sm text-muted-foreground">{event.description}</p>
              )}
              <div className="mt-5 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                <span className="flex items-center gap-2">
                  <CalendarDays className="size-4" />
                  {formatDate(event.eventDate)}
                </span>
                <span className="flex items-center gap-2">
                  <Clock3 className="size-4" />
                  {event.startTime}–{event.endTime}
                </span>
                {event.venue && (
                  <span className="flex items-center gap-2 sm:col-span-2">
                    <MapPin className="size-4" />
                    {event.venue}
                  </span>
                )}
              </div>

              {(access === "venue_staff" || access === "organiser" || access === "coordinator") && (
                <dl className="mt-5 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
                  {event.expectedAttendance !== null && event.expectedAttendance !== undefined && (
                    <Detail label="Expected attendance" value={String(event.expectedAttendance)} />
                  )}
                  {event.layout && <Detail label="Layout" value={event.layout} />}
                  {event.accessibilityRequirements && (
                    <Detail label="Accessibility" value={event.accessibilityRequirements} />
                  )}
                  {event.requiredFacilities && (
                    <Detail label="Facilities" value={event.requiredFacilities} />
                  )}
                  {event.venueRequest && (
                    <Detail label="Venue request" value={event.venueRequest.status} />
                  )}
                </dl>
              )}

              {event.equipment && event.equipment.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-sm font-medium">Equipment arrangements</p>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {event.equipment.map(item => (
                      <li key={`${event.id}-${item.item}`} className="flex justify-between gap-4">
                        <span>{item.item}</span>
                        <span className="capitalize">{item.arrangementStatus}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function WorkspaceMessage({ text }: { text: string }) {
  return (
    <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
      <ShieldAlert className="size-4" />
      {text}
    </p>
  );
}
