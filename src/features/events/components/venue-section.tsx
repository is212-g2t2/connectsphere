// oxlint-disable jsx-a11y/prefer-tag-over-role -- a group inside a description list has no semantic element.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { formatInstant, formatLocalDate } from "#/features/event-requests/format";
import { AdjustRequestRow } from "#/features/events/components/adjust-request-row";
import { ConflictBadge } from "#/features/venue-requests/components/conflict-badge";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";
import {
  EventRequirements,
  hasEventRequirements,
} from "#/features/events/components/event-requirements";
import type { EventVenueRequest } from "#/features/events/access";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { formatVenueSuggestion } from "#/features/venue-requests/schema";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";

interface VenueSource {
  eventId: number;
  access: "organiser" | "coordinator";
  status: EventRequestStatus;
  venueRequests: EventVenueRequest[];
  requirements: {
    expectedAttendance?: number | null;
    layout?: string | null;
    accessibilityRequirements?: string | null;
    requiredFacilities?: string | null;
  };
  confirmation: {
    confirmedAt: string;
    confirmedByName: string;
    venue: {
      name: string;
      date: string;
      startTime: string;
      endTime: string;
    } | null;
  } | null;
  searchable: boolean;
}

function venueSource(data: EventPageData): VenueSource | null {
  if (data.kind === "triage") {
    return {
      eventId: data.request.id,
      access: "coordinator",
      status: data.request.status,
      venueRequests: data.request.venueRequests,
      requirements: {
        expectedAttendance: data.request.expectedAttendance,
        layout: data.request.roomLayoutPreference,
        accessibilityRequirements: data.request.accessibilityRequirements,
        requiredFacilities: data.request.venueRequirements,
      },
      confirmation: null,
      searchable: false,
    };
  }
  if (data.event.access !== "organiser" && data.event.access !== "coordinator") return null;
  const { event } = data.event;
  return {
    eventId: event.id,
    access: data.event.access,
    status: event.status,
    venueRequests: event.venueRequests ?? [],
    requirements: event,
    confirmation: event.confirmation ?? null,
    searchable: true,
  };
}

/** One venue-request entry: venue, period, state, and its own rejection or release. */
function VenueRequestEntry({
  entry,
  access,
  eventId,
  eventStatus,
}: {
  entry: EventVenueRequest;
  access: "organiser" | "coordinator";
  eventId: number;
  eventStatus: EventRequestStatus;
}) {
  const showRejection = entry.status === "rejected" && entry.rejection !== undefined;
  const showAdjust =
    access === "coordinator" &&
    entry.adjustable === true &&
    SEARCHABLE_EVENT_STATUSES.includes(eventStatus);
  return (
    <div
      role="group"
      aria-label={`${entry.venueName}, ${formatLocalDate(entry.date)}, ${entry.startTime}–${entry.endTime}`}
      className="grid gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:col-span-2 sm:grid-cols-2"
    >
      <VenueDetail label="Venue" value={entry.venueName} />
      <VenueDetail
        label="Period"
        value={`${formatLocalDate(entry.date)}, ${entry.startTime}–${entry.endTime}`}
      />
      <VenueDetail
        label="Status"
        value={
          <span className="flex flex-wrap items-center gap-2">
            <VenueRequestStatusBadge status={entry.status} />
            {entry.conflict && <ConflictBadge conflict={entry.conflict} />}
          </span>
        }
      />
      {showRejection && entry.rejection && (
        <>
          <VenueDetail
            label="Rejection reason"
            value={<span className="whitespace-pre-line">{entry.rejection.reason}</span>}
          />
          {entry.rejection.suggestion && (
            <VenueDetail
              label="Suggested alternative"
              value={formatVenueSuggestion(entry.rejection.suggestion, formatLocalDate)}
            />
          )}
          {showAdjust && <AdjustRequestRow eventId={eventId} rejection={entry.rejection} />}
        </>
      )}
      {entry.release && (
        <>
          <VenueDetail
            label="Release reason"
            value={<span className="whitespace-pre-line">{entry.release.reason}</span>}
          />
          {entry.release.changedByName && (
            <VenueDetail label="Released by" value={entry.release.changedByName} />
          )}
        </>
      )}
    </div>
  );
}

/** Render the venue block as the old dashboard card did: requirements, requests, confirmation. */
function VenueBody({ data }: { data: EventPageData }) {
  const source = venueSource(data);
  if (!source) return null;
  const { access, status, venueRequests } = source;
  const hasActions =
    source.searchable && access === "coordinator" && SEARCHABLE_EVENT_STATUSES.includes(status);
  const hasRequested = hasEventRequirements(source.requirements, venueRequests.length > 0);
  if (!hasRequested && !source.confirmation && !hasActions) return null;
  return (
    <div>
      <h2 className="display-h3">Venue</h2>
      <Card className="mt-4">
        <CardContent>
          {hasRequested && (
            <>
              <p className="eyebrow text-muted-foreground">What was requested</p>
              <EventRequirements event={source.requirements} className="mt-2">
                {venueRequests.map(entry => (
                  <VenueRequestEntry
                    key={entry.id}
                    entry={entry}
                    access={access}
                    eventId={source.eventId}
                    eventStatus={status}
                  />
                ))}
              </EventRequirements>
            </>
          )}

          {/* PTR-24 AC3: the confirmed venue, date and time, and who confirmed it. */}
          {source.confirmation && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="eyebrow text-muted-foreground">Booking</p>
              <dl className="mt-2 space-y-3 body-sm" aria-label="Confirmation">
                {source.confirmation.venue ? (
                  <>
                    <VenueDetail label="Confirmed venue" value={source.confirmation.venue.name} />
                    <VenueDetail
                      label="Confirmed date and time"
                      value={`${formatLocalDate(source.confirmation.venue.date)}, ${
                        source.confirmation.venue.startTime
                      }–${source.confirmation.venue.endTime}`}
                    />
                  </>
                ) : (
                  <VenueDetail
                    label="Venue booking"
                    value="The booking has been released. The Coordinator will follow up."
                  />
                )}
                <VenueDetail
                  label="Confirmed"
                  value={`${formatInstant(new Date(source.confirmation.confirmedAt))} by ${
                    source.confirmation.confirmedByName
                  }`}
                />
              </dl>
            </div>
          )}

          {hasActions && (
            <div className="mt-4 border-t border-border pt-4">
              <Link
                to="/venues"
                search={{ eventId: source.eventId }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Find venues for this event
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Show one labelled row beside the shared requirements: one fact per venue entry. */
function VenueDetail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 body-sm text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Share the venue block between the Organiser and the Coordinator. Show it always for approved,
 * planning, and confirmed events. The Coordinator keeps it for every searchable status. It
 * carries the venue search action there. Triage shows it while the request carries venue
 * entries.
 */
export function venueSections(data: EventPageData): EventSectionDef[] {
  if (data.kind === "triage") {
    const exists = data.request.venueRequests.length > 0;
    return [
      {
        id: "venue",
        label: "Venue",
        visible: () => exists,
        render: body => <VenueBody data={body} />,
      },
    ];
  }
  if (data.event.access !== "organiser" && data.event.access !== "coordinator") return [];
  // The search action lives in this block. Hiding the block for a searchable status would
  // strand the action. The body gates the link on the same statuses.
  return [
    {
      id: "venue",
      label: "Venue",
      visible: inner => {
        const source = venueSource(inner);
        if (!source) return false;
        const { access, status, venueRequests } = source;
        const settled = status === "approved" || status === "planning" || status === "confirmed";
        const searchable = access === "coordinator" && SEARCHABLE_EVENT_STATUSES.includes(status);
        if (!settled && !searchable) return false;
        const hasActions =
          source.searchable &&
          access === "coordinator" &&
          SEARCHABLE_EVENT_STATUSES.includes(status);
        return (
          hasEventRequirements(source.requirements, venueRequests.length > 0) ||
          source.confirmation !== null ||
          hasActions
        );
      },
      render: body => <VenueBody data={body} />,
    },
  ];
}
