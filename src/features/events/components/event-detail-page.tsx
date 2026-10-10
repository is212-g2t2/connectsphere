import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Page } from "#/components/layout/page";
import {
  coordinatorClosingSections,
  coordinatorSections,
} from "#/features/coordination/components/coordinator-sections";
import { equipmentSections } from "#/features/equipment-requests/components/equipment-sections";
import { organiserRequestSections } from "#/features/event-requests/components/organiser-request-sections";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { formatLocalDate, formatProposedWindow } from "#/features/event-requests/format";
import { AttendeeEventPage } from "#/features/events/components/attendee-event-page";
import { eventTitle } from "#/features/events/components/event-card";
import { eventInformationSections } from "#/features/events/components/event-information-section";
import { registrationsSections } from "#/features/events/components/registrations-section";
import { venueSections } from "#/features/events/components/venue-section";
import { venueRequestSections } from "#/features/venue-requests/components/venue-request-sections";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** The section map for one event access, in jump-nav order. */
export function eventSections(data: EventPageData): EventSectionDef[] {
  if (data.kind === "triage") {
    return [...coordinatorSections(data), ...venueSections(data)].filter(section =>
      section.visible(data)
    );
  }
  switch (data.event.access) {
    case "attendee":
      return [];
    case "organiser":
      return [
        ...venueSections(data),
        ...registrationsSections(data),
        ...equipmentSections(data),
        ...organiserRequestSections(data),
        ...eventInformationSections(data),
      ].filter(section => section.visible(data));
    case "coordinator": {
      const [confirm, complete, releases] = coordinatorClosingSections(data);
      return [
        ...coordinatorSections(data),
        ...venueSections(data),
        ...equipmentSections(data),
        ...registrationsSections(data),
        confirm,
        ...eventInformationSections(data),
        releases,
        complete,
      ].filter(section => section.visible(data));
    }
    case "venue_staff":
      return venueRequestSections(data).filter(section => section.visible(data));
    case "technical_support":
      return equipmentSections(data).filter(section => section.visible(data));
    default: {
      const unhandled: never = data.event.access;
      throw new Error(`No event sections for access "${String(unhandled)}"`);
    }
  }
}

/**
 * The compact actions that ride the sticky rail instead of the main stack: the Coordinator's
 * assignment, cancellation, confirm and complete, and Venue Staff's record-a-decision. Every
 * other section is a record, a wide table, or a heavy form that needs the main column.
 */
export function railSectionIds(data: EventPageData): Set<string> {
  if (data.kind === "triage") return new Set(["assignment"]);
  switch (data.event.access) {
    case "coordinator":
      return new Set(["assignment", "cancellation", "confirm", "complete"]);
    case "venue_staff":
      return new Set(["decision"]);
    default:
      return new Set();
  }
}

/**
 * The anchored sections below the header block. Single column where the access has no rail
 * actions; record stack beside a sticky action rail above the `split` breakpoint.
 */
function SectionStack({ data, sections }: { data: EventPageData; sections: EventSectionDef[] }) {
  const rail = railSectionIds(data);
  const main = sections.filter(section => !rail.has(section.id));
  const railSections = sections.filter(section => rail.has(section.id));
  if (railSections.length === 0) {
    return (
      <>
        {sections.map(section => (
          <section
            key={section.id}
            id={section.id}
            aria-label={section.label}
            className="mt-8 scroll-mt-24"
          >
            {section.render(data)}
          </section>
        ))}
      </>
    );
  }
  return (
    <>
      <div className="mt-8 grid items-start gap-8 split:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          {main.map(section => (
            <section
              key={section.id}
              id={section.id}
              aria-label={section.label}
              className="mt-8 scroll-mt-24 first:mt-0"
            >
              {section.render(data)}
            </section>
          ))}
        </div>
        <aside aria-label="Actions" className="min-w-0 space-y-8 split:sticky split:top-28">
          {railSections.map(section => (
            <section
              key={section.id}
              id={section.id}
              aria-label={section.label}
              className="scroll-mt-24"
            >
              {section.render(data)}
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}

/**
 * The universal event page shell: the attendee keeps their unchanged page, and every staff access
 * gets the header block and the visible sections with `id` anchors — the
 * record stack beside a sticky action rail where the access has rail actions.
 * Renders without a router (PTR-75).
 */
export function EventDetailPage({ data }: { data: EventPageData }) {
  if (data.kind === "triage") {
    return <TriagePage data={data} />;
  }
  if (data.event.access === "attendee") {
    return <AttendeeEventPage event={data.event} />;
  }

  const { access, event } = data.event;
  const title = eventTitle(data.event);
  const sections = eventSections(data);

  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <div className="mt-6">
        <p className="eyebrow text-muted-foreground">{access.replaceAll("_", " ")} access</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <EventRequestStatusBadge status={event.status} />
        </div>
        <h1 className="mt-3 font-semibold event-title">{title}</h1>
        {event.description ? (
          <p className="mt-4 body-sm text-muted-foreground">{event.description}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 body-sm text-muted-foreground">
          {event.eventDate ? (
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4" />
              {formatLocalDate(event.eventDate)}
            </span>
          ) : null}
          {event.startTime && event.endTime ? (
            <span className="flex items-center gap-2">
              <Clock3 className="size-4" />
              {event.startTime}–{event.endTime}
            </span>
          ) : null}
        </div>

        {(access === "organiser" || access === "coordinator") && event.venue ? (
          <p className="mt-4 body-sm font-medium">{event.venue.name}</p>
        ) : null}
      </div>

      <div className="mt-6">
        <SectionStack data={data} sections={sections} />
      </div>
    </Page>
  );
}

/**
 * A coordinator opening an event they are not assigned to: the staff header read off the
 * coordination request, with the triage section set below.
 */
function TriagePage({ data }: { data: Extract<EventPageData, { kind: "triage" }> }) {
  const { request } = data;
  const sections = eventSections(data);
  const proposed = request.proposedDates.find(
    window => window.start !== undefined && window.end !== undefined
  );

  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <div className="mt-6">
        <p className="eyebrow text-muted-foreground">coordinator access</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <EventRequestStatusBadge status={request.status} />
        </div>
        <h1 className="mt-3 font-semibold event-title">
          {request.eventName.trim() || UNTITLED_REQUEST}
        </h1>

        {proposed ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 body-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4" />
              {formatProposedWindow(proposed)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <SectionStack data={data} sections={sections} />
      </div>
    </Page>
  );
}
