import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button, buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import {
  formatEntryPeriod,
  formatInstant,
  formatLocalDate,
  formatVenuePeriod,
} from "#/features/event-requests/format";
import { AdjustRequestRow } from "#/features/events/components/adjust-request-row";
import { BlockedArrangements } from "#/features/events/components/blocked-arrangements";
import { ConflictBadge } from "#/features/venue-requests/components/conflict-badge";
import { WithdrawVenueHoldRequestButton } from "#/features/venue-requests/components/venue-hold-actions";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";
import type {
  BlockedArrangement,
  EventHoldRequest,
  EventVenueRequest,
} from "#/features/events/access";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import {
  VENUE_HOLD_REQUEST_LABEL,
  VENUE_HOLD_REQUEST_NOTE,
  formatSessionSummary,
  formatVenueSuggestion,
} from "#/features/venue-requests/schema";
import { dismissVenueRequest } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";

interface VenueSource {
  eventId: number;
  /** PTR-144: whether the reader may act on this block. Only the assigned Coordinator may. */
  coordinatorActions: boolean;
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
  /** PTR-137: the Coordinator's suspended bookings and holds; empty for every other reader. */
  blocked: BlockedArrangement[];
  /** PTR-151: the Coordinator's hold requests; empty for every other reader. */
  holdRequests: EventHoldRequest[];
}

/** The Coordinator searches for venues from this block while the event takes venue requests. */
function hasVenueActions({ searchable, coordinatorActions, status }: VenueSource): boolean {
  return searchable && coordinatorActions && SEARCHABLE_EVENT_STATUSES.includes(status);
}

function venueSource(data: EventPageData): VenueSource | null {
  if (data.kind === "triage") {
    return {
      eventId: data.request.id,
      // PTR-144: the Lead reads this detail. No action renders: the link would dead-end.
      coordinatorActions: false,
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
      blocked: [],
      holdRequests: [],
    };
  }
  if (data.event.access !== "organiser" && data.event.access !== "coordinator") return null;
  const { event } = data.event;
  return {
    eventId: event.id,
    coordinatorActions: data.event.access === "coordinator",
    status: event.status,
    venueRequests: event.venueRequests ?? [],
    requirements: event,
    confirmation: event.confirmation ?? null,
    searchable: true,
    blocked: event.blockedArrangements ?? [],
    holdRequests: data.event.access === "coordinator" ? (event.holdRequests ?? []) : [],
  };
}

/**
 * One venue-request entry: venue, period, session, state, and its own rejection or release. Only
 * the Coordinator's entries carry a session.
 */
function VenueRequestEntry({
  entry,
  canAdjust,
  eventId,
  eventStatus,
}: {
  entry: EventVenueRequest;
  /** PTR-144: only the assigned Coordinator may open the adjust action. */
  canAdjust: boolean;
  eventId: number;
  eventStatus: EventRequestStatus;
}) {
  const showAdjust =
    canAdjust && entry.adjustable === true && SEARCHABLE_EVENT_STATUSES.includes(eventStatus);
  // PTR-165 AC4: only the assigned Coordinator dismisses a settled entry, and only once.
  const showDismiss =
    canAdjust &&
    entry.dismissed !== true &&
    (entry.status === "rejected" || entry.status === "released");
  // PTR-138 AC1: the Coordinator's entries carry their session, which tells two sessions apart.
  const session = entry.requirements ? formatSessionSummary(entry.requirements) : "";
  const period = formatEntryPeriod(entry);
  return (
    <dl
      aria-label={`${entry.venueName}, ${period}`}
      className="grid gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:grid-cols-2"
    >
      <VenueDetail label="Venue" value={entry.venueName} />
      <VenueDetail label="Period" value={period} />
      {session && <VenueDetail label="Session" value={session} />}
      <VenueDetail
        label="Status"
        value={
          <span className="flex flex-wrap items-center gap-2">
            <VenueRequestStatusBadge status={entry.status} />
            {entry.conflict && <ConflictBadge conflict={entry.conflict} />}
            {entry.dismissed && <span className="body-sm text-muted-foreground">Dismissed</span>}
          </span>
        }
      />
      {entry.rejection && (
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
          {showAdjust && (
            <AdjustRequestRow eventId={eventId} entry={entry} rejection={entry.rejection} />
          )}
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
      {showDismiss && (
        <VenueDetail label="Or dismiss" value={<DismissRequestAction entry={entry} />} />
      )}
    </dl>
  );
}

/**
 * PTR-151 AC2: one requested hold on the event. It protects no venue time until Venue Staff place
 * it, so the label and the note say that. Only the Coordinator gets the withdraw action.
 */
function HoldRequestEntry({ hold, canWithdraw }: { hold: EventHoldRequest; canWithdraw: boolean }) {
  const period = formatVenuePeriod(hold.startsAt, hold.endsAt);
  return (
    <dl
      aria-label={`${hold.venueName}, ${period}`}
      className="grid gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:grid-cols-2"
    >
      <VenueDetail label="Venue" value={hold.venueName} />
      <VenueDetail label="Period" value={period} />
      <VenueDetail
        label="Status"
        value={<Badge variant="outline">{VENUE_HOLD_REQUEST_LABEL}</Badge>}
      />
      {canWithdraw && (
        <VenueDetail
          label="Next step"
          value={<WithdrawVenueHoldRequestButton holdId={hold.id} />}
        />
      )}
    </dl>
  );
}

/**
 * PTR-165 AC4: the assigned Coordinator dismisses a settled request it no longer needs. The row
 * keeps its history and stops blocking confirmation. The server re-reads the assignment. Dismissing
 * is a one-way action, so confirm it first, as withdrawal on the venue page does.
 */
function DismissRequestAction({ entry }: { entry: EventVenueRequest }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const noun = entry.status === "rejected" ? "request" : "booking";
  const [dismiss, run, dismissing] = useMutation(async () => {
    await dismissVenueRequest({ data: { id: entry.id } });
    setOpen(false);
    toast.success("Request dismissed.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not dismiss this request. Try again.");

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={dismissing}
            aria-label={`Dismiss ${noun} for ${entry.venueName}, ${formatEntryPeriod(entry)}`}
          />
        }
      >
        Dismiss {noun}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Dismiss this {noun}?</AlertDialogTitle>
          <AlertDialogDescription>
            The {entry.status} {noun} for {entry.venueName} on {formatEntryPeriod(entry)} stays on
            record and no longer blocks confirmation. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={dismissing}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={dismissing} onClick={() => void run()}>
            {dismissing ? "Dismissing…" : `Dismiss ${noun}`}
          </AlertDialogAction>
        </AlertDialogFooter>
        {dismiss.status === "error" && (
          <p role="alert" className="body-sm text-destructive">
            {dismiss.error}
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Render the venue block as the old dashboard card did: requirements, requests, confirmation. */
function VenueBody({ data }: { data: EventPageData }) {
  const source = venueSource(data);
  if (!source) return null;
  const { status, venueRequests, holdRequests } = source;
  const hasActions = hasVenueActions(source);
  const hasRequested = venueRequests.length > 0;
  const hasHoldRequests = holdRequests.length > 0;
  const hasBlocked = source.blocked.length > 0;
  if (!hasRequested && !hasHoldRequests && !source.confirmation && !hasActions && !hasBlocked) {
    return null;
  }
  return (
    <div>
      <h2 id="venue-section-heading" tabIndex={-1} className="display-h3 outline-none">
        Venue
      </h2>
      <Card className="mt-4">
        <CardContent>
          {hasBlocked && (
            <BlockedArrangements
              eventId={source.eventId}
              arrangements={source.blocked}
              searchable={hasVenueActions(source)}
            />
          )}
          {hasRequested && (
            <>
              <p className="eyebrow text-muted-foreground">What was requested</p>
              {/* Each venue request is its own description list. The first list in the stack
                  draws no top rule. The request details or event information section carries
                  the requirements, so this block lists the requests alone. */}
              <div className="mt-2 grid gap-3">
                {venueRequests.map(entry => (
                  <VenueRequestEntry
                    key={entry.id}
                    entry={entry}
                    canAdjust={source.coordinatorActions}
                    eventId={source.eventId}
                    eventStatus={status}
                  />
                ))}
              </div>
            </>
          )}

          {hasHoldRequests && (
            <div className={hasRequested ? "mt-4 border-t border-border pt-4" : ""}>
              <p className="eyebrow text-muted-foreground">Hold requests</p>
              <p className="mt-2 body-sm text-muted-foreground">{VENUE_HOLD_REQUEST_NOTE}</p>
              <div className="mt-2 grid gap-3">
                {holdRequests.map(hold => (
                  <HoldRequestEntry
                    key={hold.id}
                    hold={hold}
                    canWithdraw={source.coordinatorActions}
                  />
                ))}
              </div>
            </div>
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

          {/* While a block suspends the arrangements, the panel carries the search action. */}
          {hasActions && !hasBlocked && (
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
 * carries the venue search action there. In a searchable status, the Organiser sees it while the
 * event has venue requests (PTR-138 AC5). Triage shows it while the request carries venue entries.
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
        const { coordinatorActions, status, venueRequests } = source;
        const settled = status === "approved" || status === "planning" || status === "confirmed";
        const searchable =
          SEARCHABLE_EVENT_STATUSES.includes(status) &&
          (coordinatorActions || venueRequests.length > 0);
        if (!settled && !searchable) return false;
        return (
          venueRequests.length > 0 ||
          source.holdRequests.length > 0 ||
          source.confirmation !== null ||
          hasVenueActions(source) ||
          source.blocked.length > 0
        );
      },
      render: body => <VenueBody data={body} />,
    },
  ];
}
