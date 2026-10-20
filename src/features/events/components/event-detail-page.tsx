import { Suspense, lazy } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Page } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatLocalDate } from "#/features/event-requests/format";
import { AttendeeEventPage } from "#/features/events/components/attendee-event-page";
import { eventTitle } from "#/features/events/components/event-card";
import type { EventPageData } from "#/features/events/page-data";
import { safetyReviewStageLabel } from "#/features/safety-reviews/schema";
import type { SafetyReviewStage } from "#/features/safety-reviews/schema";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

// The staff sections ride in a second chunk. The attendee early return below never reaches
// this import, so the most common access skips the coordinator, venue, and equipment code.
const loadStaffPage = () => import("#/features/events/components/event-staff-page");
const StaffSections = lazy(() =>
  loadStaffPage().then(mod => ({
    default: mod.StaffSections,
  }))
);
const TriagePage = lazy(() =>
  loadStaffPage().then(mod => ({
    default: mod.TriagePage,
  }))
);

/**
 * Render the universal event page shell. The Attendee keeps their unchanged page. Every staff
 * access gets the sync header block below, with its sections loading behind it. It renders
 * without a router (PTR-75).
 */
export function EventDetailPage({ data }: { data: EventPageData }) {
  if (data.kind === "triage") {
    return (
      <Suspense fallback={<EventSectionsFallback />}>
        <TriagePage data={data} />
      </Suspense>
    );
  }
  if (data.event.access === "attendee") {
    return <AttendeeEventPage event={data.event} />;
  }

  const { access, event } = data.event;
  const title = eventTitle(data.event);
  // PTR-158 AC2: the Organiser and Coordinator read the safety stage until confirmation. Lists
  // and cards keep the plain status, because their projections carry no `safetyStage`.
  const stageLabel =
    access === "organiser" || access === "coordinator"
      ? safetyReviewStageLabel(event.status, event.safetyStage)
      : null;

  return (
    <Page width="wide">
      <Link to={access === "lead" ? "/coordination" : "/dashboard"} className={NAV_LINK_CLASSNAME}>
        {access === "lead" ? "Back to coordination" : "Back to dashboard"}
      </Link>

      <div className="mt-6">
        <p className="eyebrow text-muted-foreground">{access.replaceAll("_", " ")} access</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {stageLabel ? (
            <Badge variant={stageVariant(event.safetyStage)} aria-label={`Stage: ${stageLabel}`}>
              {stageLabel}
            </Badge>
          ) : (
            <EventRequestStatusBadge status={event.status} />
          )}
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
        <Suspense fallback={<EventSectionsFallback />}>
          <StaffSections data={data} />
        </Suspense>
      </div>
    </Page>
  );
}

/**
 * PTR-158 AC2: a current approval reads as settled and a current rejection as stopped. Every
 * other safety stage, including an out-of-date one, is still in progress.
 */
function stageVariant(stage: SafetyReviewStage | null | undefined) {
  if (stage?.current && stage.state === "approved") return "confirmed" as const;
  if (stage?.current && stage.state === "rejected") return "stopped" as const;
  return "progress" as const;
}

/** Hold the sections' place below the sync header while their chunk loads. */
function EventSectionsFallback() {
  return (
    <div aria-busy="true">
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a loading line reports status, not a calculation result */}
      <div role="status" className="sr-only">
        Loading sections…
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="mt-8 h-40 w-full" />
    </div>
  );
}
