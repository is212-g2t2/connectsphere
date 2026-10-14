import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Card, CardContent } from "#/components/ui/card";
import { Detail } from "#/features/event-requests/components/request-message-blocks";
import type { EventVenueRequest } from "#/features/events/access";
import { formatLocalDate, formatProposedWindow } from "#/features/event-requests/format";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { ApproveBookingButton } from "#/features/venue-requests/components/approve-booking-button";
import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import { ConflictBadge } from "#/features/venue-requests/components/conflict-badge";
import { RejectBookingForm } from "#/features/venue-requests/components/reject-booking-form";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";
import { formatVenueSuggestion } from "#/features/venue-requests/schema";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";
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

/** One projection period as the decision headings show it, so every period reads the same. */
function projectionPeriod(entry: { date: string; startTime: string; endTime: string }): string {
  return formatProposedWindow({
    start: `${entry.date}T${entry.startTime.slice(0, 5)}`,
    end: `${entry.date}T${entry.endTime.slice(0, 5)}`,
  });
}

/** The short note under a settled entry's heading. */
const OUTCOME_NOTES: Record<string, string> = {
  approved: "Booking approved.",
  rejected: "Request declined.",
  released: "Booking released.",
};

/** The note for a pending entry when the read of the full requests failed. */
const PENDING_NOT_LOADED_NOTE = "The full request did not load. Reload the page to decide it.";
/** The note for a pending entry that the read no longer returns: someone decided it meanwhile. */
const PENDING_DECIDED_NOTE =
  "This request was decided after the page loaded. Reload the page to see the outcome.";

/**
 * Pair each pending projection entry with its loaded request, in projection order. An entry
 * with no loaded request was decided after the projection loaded.
 */
function loadedRequests(data: EventPageData): PendingVenueRequestDetail[] {
  if (data.kind !== "event" || !data.venueDecisions) return [];
  const loadedById = new Map(data.venueDecisions.requests.map(request => [request.id, request]));
  return pendingEntries(data).flatMap(entry => loadedById.get(entry.id) ?? []);
}

/** Show one block per projection entry: the loaded pending request, or the entry's outcome. */
function RequestBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const loadedById = new Map(loadedRequests(data).map(request => [request.id, request]));
  const pendingNote = data.venueDecisions ? PENDING_DECIDED_NOTE : PENDING_NOT_LOADED_NOTE;
  return (
    <>
      {(data.event.event.venueRequests ?? []).map(entry => {
        const loaded = loadedById.get(entry.id);
        return (
          <div
            key={entry.id}
            className="mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
          >
            {loaded ? (
              <BookingRequestDetails request={loaded} />
            ) : (
              <VenueRequestOutcome
                entry={entry}
                note={
                  entry.status === "pending" ? pendingNote : (OUTCOME_NOTES[entry.status] ?? null)
                }
              />
            )}
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
  const requests = loadedRequests(data);
  const venues = data.kind === "event" ? (data.venueDecisions?.venues ?? []) : [];
  const groupCount = requests.length;
  const firstGroupRef = useRef<HTMLHeadingElement | null>(null);
  const previousCount = useRef<number | null>(null);
  // A decision removes its group. Move focus to the first group that remains, so a reader
  // hears what still needs a decision. Follow the `venue-request-panel` pattern.
  useEffect(() => {
    const previous = previousCount.current;
    previousCount.current = groupCount;
    if (previous !== null && groupCount > 0 && groupCount < previous) {
      firstGroupRef.current?.focus();
    }
  }, [groupCount]);
  if (data.kind !== "event") return null;
  const refresh = () => router.invalidate({ filter: skipRootFilter });
  // Pending entries remain, but no full request loaded. Say why instead of hiding the section.
  if (groupCount === 0) {
    return (
      <div>
        <h2 className="display-h3">Record a decision</h2>
        <p className="mt-2 body-sm text-muted-foreground">
          {data.venueDecisions
            ? "These requests were decided after the page loaded. Reload the page to see the outcome."
            : PENDING_NOT_LOADED_NOTE}
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
      {requests.map((request, index) => (
        <div key={request.id} className="mt-6 border-t border-border pt-6">
          <h3
            ref={index === 0 ? firstGroupRef : undefined}
            tabIndex={index === 0 ? -1 : undefined}
            className="display-h3"
          >
            {request.venueName},{" "}
            {formatProposedWindow({ start: request.startsAt, end: request.endsAt })}
          </h3>
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
 * Show one projection entry without its full request: a settled outcome, or a pending request
 * whose read failed. The heading names the venue and period once. A rejection adds its reason
 * and any suggested alternative. A release adds its reason and who released it.
 */
function VenueRequestOutcome({ entry, note }: { entry: EventVenueRequest; note: string | null }) {
  const suggestion = entry.rejection?.suggestion
    ? formatVenueSuggestion(entry.rejection.suggestion, formatLocalDate)
    : "";
  const headingId = `booking-request-outcome-heading-${entry.id}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="display-h3">
        Booking request details: {entry.venueName}, {projectionPeriod(entry)}
      </h2>
      {note ? <p className="mt-2 body-md font-medium">{note}</p> : null}
      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Status">
              <span className="flex flex-wrap items-center gap-2">
                <VenueRequestStatusBadge status={entry.status} />
                {entry.conflict ? <ConflictBadge conflict={entry.conflict} /> : null}
              </span>
            </Detail>
            {entry.rejection ? (
              <>
                <Detail term="Rejection reason" wide>
                  {entry.rejection.reason}
                </Detail>
                {suggestion ? (
                  <Detail term="Suggested alternative" wide>
                    {suggestion}
                  </Detail>
                ) : null}
              </>
            ) : null}
            {entry.release ? (
              <>
                <Detail term="Release reason" wide>
                  {entry.release.reason}
                </Detail>
                {entry.release.changedByName ? (
                  <Detail term="Released by">{entry.release.changedByName}</Detail>
                ) : null}
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
