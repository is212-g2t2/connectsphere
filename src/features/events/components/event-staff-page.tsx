import { CalendarDays } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Page } from "#/components/layout/page";
import { ChangeRequestApplyProvider } from "#/features/coordination/components/change-request-decisions";
import {
  coordinatorClosingSections,
  coordinatorSections,
  leadAssignmentSections,
} from "#/features/coordination/components/coordinator-sections";
import { equipmentSections } from "#/features/equipment-requests/components/equipment-sections";
import { organiserRequestSections } from "#/features/event-requests/components/organiser-request-sections";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { formatProposedWindow } from "#/features/event-requests/format";
import { eventInformationSections } from "#/features/events/components/event-information-section";
import { registrationsSections } from "#/features/events/components/registrations-section";
import { venueSections } from "#/features/events/components/venue-section";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import {
  safetyReReviewSections,
  safetySections,
} from "#/features/safety-reviews/components/safety-review-sections";
import { venueRequestSections } from "#/features/venue-requests/components/venue-request-sections";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * Staff-only half of the universal event page. `EventDetailPage` loads this module behind
 * `Suspense`, so the attendee early return never pulls the coordinator, venue, and equipment
 * section code into the attendee chunk. It renders without a router (PTR-75).
 */

/** Map the sections for one event access, in display order. */
export function eventSections(data: EventPageData): EventSectionDef[] {
  if (data.kind === "triage") {
    return [
      ...coordinatorSections(data),
      ...leadAssignmentSections(data),
      ...venueSections(data),
    ].filter(section => section.visible(data));
  }
  switch (data.event.access) {
    case "attendee":
      return [];
    case "lead":
      // PTR-144: the Lead reads the record. PTR-145 adds the assignment form; the rest of the
      // page stays read-only.
      return [...leadAssignmentSections(data), ...eventInformationSections(data)].filter(section =>
        section.visible(data)
      );
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
        ...safetyReReviewSections(data),
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
    case "safety_officer":
      return safetySections(data).filter(section => section.visible(data));
    default: {
      const unhandled: never = data.event.access;
      throw new Error(`No event sections for access "${String(unhandled)}"`);
    }
  }
}

/**
 * Place compact actions on the sticky rail instead of the main stack. These are the Coordinator's
 * cancellation, confirm, and complete, plus Venue Staff's record-a-decision. Every other section
 * is a record, a wide table, or a heavy form. Those need the main column.
 */
export function railSectionIds(data: EventPageData): Set<string> {
  // PTR-144: the Lead's detail has no rail action; the assignment form sits in the main column.
  if (data.kind === "triage") return new Set();
  switch (data.event.access) {
    case "coordinator":
      return new Set(["cancellation", "confirm", "complete"]);
    case "venue_staff":
      return new Set(["decision"]);
    default:
      return new Set();
  }
}

/**
 * Render the anchored sections below the header block. Use a single column where the access has
 * no rail actions. Show the record stack beside a sticky action rail above the `split`
 * breakpoint.
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
        <aside
          aria-label="Actions"
          className="order-first min-w-0 space-y-8 split:order-none split:sticky split:top-28"
        >
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
 * Render the staff sections below the sync header. Mount the apply provider for the Coordinator
 * only: it bridges two coordinator-only sections (PTR-52).
 */
export function StaffSections({ data }: { data: Extract<EventPageData, { kind: "event" }> }) {
  const sections = eventSections(data);
  if (data.event.access === "coordinator") {
    return (
      <ChangeRequestApplyProvider>
        <SectionStack data={data} sections={sections} />
      </ChangeRequestApplyProvider>
    );
  }
  return <SectionStack data={data} sections={sections} />;
}

/**
 * Show the Lead the unassigned request behind a queue row (PTR-144). Read the staff header off
 * the coordination request. Place the read-only sections below.
 */
export function TriagePage({ data }: { data: Extract<EventPageData, { kind: "triage" }> }) {
  const { request } = data;
  const sections = eventSections(data);
  const proposed = request.proposedDates.find(
    window => window.start !== undefined && window.end !== undefined
  );

  return (
    <Page width="wide">
      <Link to="/coordination" className={NAV_LINK_CLASSNAME}>
        Back to coordination
      </Link>

      <div className="mt-6">
        <p className="eyebrow text-muted-foreground">unassigned request</p>
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
