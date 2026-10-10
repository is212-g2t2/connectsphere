import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { formatInstant, formatLocalDate } from "#/features/event-requests/format";
import { AdjustRequestRow } from "#/features/events/components/adjust-request-row";
import {
  EventRequirements,
  hasEventRequirements,
} from "#/features/events/components/event-requirements";
import type { EventVenueRequest } from "#/features/events/access";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { formatVenueSuggestion } from "#/features/venue-requests/schema";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";

/** The review statuses, the only ones where a rejected request keeps the block mounted. */
const REVIEW_STATUSES: readonly EventRequestStatus[] = [
  "submitted",
  "under_review",
  "awaiting_organiser",
];

interface VenueSource {
  eventId: number;
  access: "organiser" | "coordinator";
  status: EventRequestStatus;
  venueRequest: EventVenueRequest | null;
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
      venueRequest: data.request.venueRequest ?? null,
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
    venueRequest: event.venueRequest ?? null,
    requirements: event,
    confirmation: event.confirmation ?? null,
    searchable: true,
  };
}

/** The venue block as the old dashboard card rendered it: requirements, request, confirmation. */
function VenueBody({ data }: { data: EventPageData }) {
  const source = venueSource(data);
  if (!source) return null;
  const { access, status, venueRequest } = source;
  const hasActions =
    source.searchable && access === "coordinator" && SEARCHABLE_EVENT_STATUSES.includes(status);
  const hasRequested = hasEventRequirements(source.requirements, venueRequest !== null);
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
                {venueRequest && (
                  <>
                    <VenueDetail
                      label="Venue request"
                      value={
                        <span className="flex flex-wrap items-center gap-2">
                          {venueRequest.status === "rejected" ? (
                            <Badge variant="stopped">Rejected</Badge>
                          ) : venueRequest.status === "released" ? (
                            <Badge variant="stopped">Released</Badge>
                          ) : (
                            <Badge variant="progress">Pending</Badge>
                          )}
                          {venueRequest.conflict && (
                            <Badge variant="stopped">
                              {venueRequest.conflict === "hold"
                                ? "Conflicting hold"
                                : "Conflicting booking"}
                            </Badge>
                          )}
                        </span>
                      }
                    />
                    {venueRequest.rejection && (
                      <>
                        <VenueDetail
                          label={
                            venueRequest.status === "rejected"
                              ? "Rejected booking"
                              : "Previously rejected booking"
                          }
                          value={`${venueRequest.rejection.venueName}, ${formatLocalDate(
                            venueRequest.rejection.date
                          )}, ${venueRequest.rejection.startTime}–${venueRequest.rejection.endTime}`}
                        />
                        <VenueDetail
                          label="Rejection reason"
                          value={
                            <span className="whitespace-pre-line">
                              {venueRequest.rejection.reason}
                            </span>
                          }
                        />
                        {venueRequest.rejection.suggestion && (
                          <VenueDetail
                            label="Suggested alternative"
                            value={formatVenueSuggestion(
                              venueRequest.rejection.suggestion,
                              formatLocalDate
                            )}
                          />
                        )}
                        {access === "coordinator" &&
                          venueRequest.status === "rejected" &&
                          status === "submitted" && (
                            <AdjustRequestRow
                              eventId={source.eventId}
                              rejection={venueRequest.rejection}
                            />
                          )}
                      </>
                    )}
                    {venueRequest.release && (
                      <>
                        <VenueDetail
                          label="Released booking"
                          value={`${venueRequest.release.venueName}, ${formatLocalDate(
                            venueRequest.release.date
                          )}, ${venueRequest.release.startTime}–${venueRequest.release.endTime}`}
                        />
                        <VenueDetail
                          label="Release reason"
                          value={
                            <span className="whitespace-pre-line">
                              {venueRequest.release.reason}
                            </span>
                          }
                        />
                        {venueRequest.release.changedByName && (
                          <VenueDetail
                            label="Released by"
                            value={venueRequest.release.changedByName}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
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

/** One labelled row beside the shared requirements: the card's pending request. */
function VenueDetail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 body-sm text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The venue block the Organiser and the Coordinator share: approved, planning, and confirmed
 * events always; the review statuses only while a rejected request waits for adjustment. The
 * Coordinator keeps it for every searchable status, where the block carries the venue search
 * action. Triage shows it while the request carries a venue request.
 */
export function venueSections(data: EventPageData): EventSectionDef[] {
  if (data.kind === "triage") {
    const exists = (data.request.venueRequest ?? null) !== null;
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
  // The search action lives in this block, so hiding the block for a searchable status would
  // strand the action. The body gates the link itself on the same statuses.
  return [
    {
      id: "venue",
      label: "Venue",
      visible: inner => {
        const source = venueSource(inner);
        if (!source) return false;
        const { access, status, venueRequest } = source;
        const settled = status === "approved" || status === "planning" || status === "confirmed";
        const adjusting =
          REVIEW_STATUSES.some(candidate => candidate === status) &&
          (venueRequest?.status ?? null) === "rejected";
        const searchable = access === "coordinator" && SEARCHABLE_EVENT_STATUSES.includes(status);
        if (!settled && !adjusting && !searchable) return false;
        const hasActions =
          source.searchable &&
          access === "coordinator" &&
          SEARCHABLE_EVENT_STATUSES.includes(status);
        return (
          hasEventRequirements(source.requirements, venueRequest !== null) ||
          source.confirmation !== null ||
          hasActions
        );
      },
      render: body => <VenueBody data={body} />,
    },
  ];
}
