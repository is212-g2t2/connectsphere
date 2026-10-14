import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { Detail } from "#/features/event-requests/components/request-message-blocks";
import type { EventVenueRequest } from "#/features/events/access";
import { formatLocalDate, formatProposedWindow } from "#/features/event-requests/format";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { ApproveBookingButton } from "#/features/venue-requests/components/approve-booking-button";
import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import { RejectBookingForm } from "#/features/venue-requests/components/reject-booking-form";
import { VenueStateBadge } from "#/features/venue-requests/components/venue-state-badge";
import { formatVenueSuggestion } from "#/features/venue-requests/schema";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * Show every booking request to Venue Staff and let them decide the pending ones. The request
 * section lists one block per projection entry. The decision section holds one approve/reject
 * group per loaded pending request. A decision group disappears once its request leaves
 * `pending`. The rail splits on the `request` and `decision` ids, so keep them.
 */
export function venueRequestSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event" || data.event.access !== "venue_staff") return [];
  return [
    {
      id: "request",
      label: "Booking request details",
      visible: inner =>
        inner.kind === "event" && (inner.event.event.venueRequests ?? []).length > 0,
      render: inner => <RequestBody data={inner} />,
    },
    {
      id: "decision",
      label: "Record a decision",
      visible: inner =>
        inner.kind === "event" &&
        pendingEntries(inner).length > 0 &&
        inner.event.event.status !== "cancelled",
      render: inner => <DecisionBody data={inner} />,
    },
  ];
}

/** Every projection entry still waiting for a decision. */
function pendingEntries(data: EventPageData): EventVenueRequest[] {
  if (data.kind !== "event") return [];
  return (data.event.event.venueRequests ?? []).filter(entry => entry.status === "pending");
}

/** One projection window as the decision headings show it, so every window reads the same. */
function projectionWindow(entry: { date: string; startTime: string; endTime: string }): string {
  return formatProposedWindow({
    start: `${entry.date}T${entry.startTime.slice(0, 5)}`,
    end: `${entry.date}T${entry.endTime.slice(0, 5)}`,
  });
}

/** Show one block per projection entry: the loaded detail, a read-only fallback, or the outcome. */
function RequestBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const entries = data.event.event.venueRequests ?? [];
  const loadedById = new Map(
    (data.venueDecisions ?? []).map(decision => [decision.request.id, decision.request])
  );
  return (
    <>
      {entries.map(entry => {
        const loaded = loadedById.get(entry.id);
        if (entry.status === "pending" && loaded)
          return (
            <div
              key={entry.id}
              className="mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
            >
              <BookingRequestDetails request={loaded} />
            </div>
          );
        if (entry.status === "pending")
          return (
            <div
              key={entry.id}
              className="mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
            >
              <PendingRequestFallback entry={entry} />
            </div>
          );
        return (
          <div
            key={entry.id}
            className="mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
          >
            <VenueRequestOutcome outcome={entry} />
          </div>
        );
      })}
    </>
  );
}

/**
 * Show the decision controls and the old page's text, one approve/reject group per loaded
 * pending request. The loader's `venueDecisions` gates the controls. Server middleware still
 * checks the user's `venue_request:decide` permission.
 */
function DecisionBody({ data }: { data: EventPageData }) {
  const router = useRouter();
  const venueDecisions = data.kind === "event" ? (data.venueDecisions ?? []) : [];
  const groupIds = venueDecisions.map(decision => decision.request.id).join(",");
  const firstGroupRef = useRef<HTMLHeadingElement | null>(null);
  const previousIds = useRef<string | null>(null);
  const previousCount = useRef<number | null>(null);
  // A decision removes its group. Move focus to the first group that remains, so a reader
  // hears what still needs a decision. Follow the `venue-request-panel` pattern.
  useEffect(() => {
    const previous = previousIds.current;
    const prevCount = previousCount.current;
    previousIds.current = groupIds;
    previousCount.current = venueDecisions.length;
    if (previous === null || previous === groupIds) return;
    if (prevCount !== null && venueDecisions.length < prevCount && venueDecisions.length > 0)
      firstGroupRef.current?.focus();
  }, [groupIds, venueDecisions.length]);
  if (data.kind !== "event") return null;
  const refresh = () => router.invalidate({ filter: skipRootFilter });
  // Every detail read failed, but pending entries remain. Say so instead of hiding the section.
  if (venueDecisions.length === 0) {
    return (
      <div>
        <h2 className="display-h3">Record a decision</h2>
        <p className="mt-2 body-sm text-muted-foreground">
          The full request did not load. Reload the page to decide it.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="display-h3">Record a decision</h2>
      <p className="mt-2 body-sm text-muted-foreground">
        Approving holds the venue for this exact period. Rejecting needs a reason, and you can
        suggest an alternative. Either way the requesting Coordinator is notified.
      </p>
      {venueDecisions.map(({ request, venues }, index) => (
        <div key={request.id} className="mt-6 border-t border-border pt-6">
          <h3
            ref={index === 0 ? firstGroupRef : undefined}
            tabIndex={index === 0 ? -1 : undefined}
            className="display-h3"
          >
            {request.venueName},{" "}
            {formatProposedWindow({ start: request.startsAt, end: request.endsAt })}
          </h3>
          {request.conflict ? (
            <Badge className="mt-2" variant="stopped">
              {request.conflict === "hold" ? "Conflicting hold" : "Conflicting booking"}
            </Badge>
          ) : null}
          <div className="mt-4">
            <ApproveBookingButton request={request} onDecided={refresh} />
          </div>
          <div className="mt-6">
            <h4 className="body-md font-semibold">Reject this request</h4>
            <div className="mt-4">
              <RejectBookingForm request={request} venues={venues} onDecided={refresh} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Show a pending entry whose detail read failed. Venue and period come from the projection, so
 * the entry stays visible. Its decision group is absent; when no group loads at all, the
 * decision section says the request did not load instead of hiding.
 */
function PendingRequestFallback({ entry }: { entry: EventVenueRequest }) {
  const window = projectionWindow(entry);
  const headingId = `booking-request-fallback-heading-${entry.id}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="display-h3">
        Booking request details: {entry.venueName}, {window}
      </h2>
      <p className="mt-2 body-sm text-muted-foreground">
        The full request did not load. Reload the page to decide it.
      </p>
      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Status">
              <VenueStateBadge status="pending" />
            </Detail>
            <Detail term="Venue">{entry.venueName}</Detail>
            <Detail term="Period" wide>
              {window}
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Show a settled request's status and venue, rejection and suggested alternative, or release
 * record. Use the same labels as the dashboard's venue request block.
 *
 * Show the settled outcome's short banner above the detail rows.
 */
const OUTCOME_BANNERS: Record<string, string> = {
  approved: "Booking approved.",
  rejected: "Request declined.",
  released: "Booking released.",
};

function VenueRequestOutcome({ outcome }: { outcome: EventVenueRequest }) {
  const suggestion = outcome.rejection?.suggestion
    ? formatVenueSuggestion(outcome.rejection.suggestion, formatLocalDate)
    : "";
  const banner = OUTCOME_BANNERS[outcome.status] ?? null;
  const headingId = `booking-request-outcome-heading-${outcome.id}`;
  const window = projectionWindow(outcome);
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="display-h3">
        Booking request details: {outcome.venueName}, {window}
      </h2>
      {banner ? <p className="mt-2 body-md font-medium">{banner}</p> : null}
      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Status">
              <VenueStateBadge status={outcome.status} />
            </Detail>
            {outcome.venueName ? <Detail term="Venue">{outcome.venueName}</Detail> : null}
            <Detail term="Period" wide>
              {window}
            </Detail>
            {outcome.rejection ? (
              <>
                <Detail term="Rejected booking" wide>
                  {`${outcome.rejection.venueName}, ${formatLocalDate(outcome.rejection.date)}, ${outcome.rejection.startTime}–${outcome.rejection.endTime}`}
                </Detail>
                <Detail term="Rejection reason" wide>
                  {outcome.rejection.reason}
                </Detail>
                {suggestion ? (
                  <Detail term="Suggested alternative" wide>
                    {suggestion}
                  </Detail>
                ) : null}
              </>
            ) : null}
            {outcome.release ? (
              <>
                <Detail term="Released booking" wide>
                  {`${outcome.release.venueName}, ${formatLocalDate(outcome.release.date)}, ${outcome.release.startTime}–${outcome.release.endTime}`}
                </Detail>
                <Detail term="Release reason" wide>
                  {outcome.release.reason}
                </Detail>
                {outcome.release.changedByName ? (
                  <Detail term="Released by">{outcome.release.changedByName}</Detail>
                ) : null}
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
