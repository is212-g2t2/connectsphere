import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { eventTitle } from "#/features/events/components/event-title";
import { WithdrawAction } from "#/features/events/components/withdraw-action";
import type { EventProjection } from "#/features/events/access";
import { hasAttendeePage } from "#/features/events/access";
import {
  EVENT_REQUEST_STATUS_LABELS,
  EVENT_REQUEST_STATUS_VARIANTS,
} from "#/features/event-requests/schema";
import { formatEntryPeriod, formatLocalDate } from "#/features/event-requests/format";
import {
  VENUE_REQUEST_STATUS_LABELS,
  VENUE_REQUEST_STATUS_VARIANTS,
} from "#/features/venue-requests/schema";

/**
 * Whether the reader can move this row forward: the work their own role owns. Venue Staff own
 * pending venue requests, Technical Support own arrangeable equipment lines, Safety Officers own
 * the events under their reviews, the Lead owns unassigned rows, the Organiser owns rows waiting
 * on them, and the Coordinator owns submitted rows. The dashboard sorts these rows first, and the
 * unit test pins the rule.
 */
export function isActionableRow(
  projection: EventProjection,
  safetyReviewEventIds: readonly number[] = []
): boolean {
  const { access, event } = projection;
  if (access === "lead") return event.awaitingAssignment === true;
  if (access === "venue_staff")
    return (event.venueRequests ?? []).some(entry => entry.status === "pending");
  if (access === "technical_support")
    return (event.equipment ?? []).some(line => line.arrangeable === true);
  if (access === "safety_officer") return safetyReviewEventIds.includes(event.id);
  if (access === "organiser") return event.status === "awaiting_organiser";
  if (access === "attendee") {
    return (
      event.registration?.status === "registered" &&
      event.status !== "confirmed" &&
      event.status !== "completed" &&
      event.status !== "cancelled"
    );
  }
  return event.status === "submitted" || event.status === "under_review";
}

/** The row opens the event page exactly when the reader has one: every staff access, and an
 * attendee only once the event is published or cancelled (PTR-50 AC4). */
function canOpenRow(projection: EventProjection): boolean {
  const { access, event } = projection;
  return access !== "attendee" || hasAttendeePage(event);
}

/** The status names its entity, so a mixed dashboard never shows a bare "Pending". The Lead
 * reads assignment state instead of the event status: it is the only fact their queue tracks. */
function RowStatus({ projection }: { projection: EventProjection }) {
  const { access, event } = projection;
  if (access === "lead") {
    const unassigned = event.awaitingAssignment === true;
    return (
      <Badge variant={unassigned ? "progress" : "confirmed"}>
        {unassigned ? "Unassigned" : "Assigned"}
      </Badge>
    );
  }
  return (
    <Badge variant={EVENT_REQUEST_STATUS_VARIANTS[event.status]}>
      Event: {EVENT_REQUEST_STATUS_LABELS[event.status]}
    </Badge>
  );
}

/** The event date as a small block. It renders from the stored civil date, never a `Date`. */
function DateBlock({ date }: { date: string }) {
  const [day, month] = formatLocalDate(date).split(" ");
  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-muted"
    >
      <span className="text-lg font-semibold leading-none">{day}</span>
      <span className="text-xs text-muted-foreground">{month}</span>
    </div>
  );
}

/**
 * One dashboard row: a date block, the title as the only link, date and time meta, and a scoped
 * status. A Venue Staff row lists each request with its period and scoped pill instead of
 * the event date (PTR-138 AC5). A registered attendee on a non-confirmed event gets the Withdraw
 * registration action below the row instead of a dead card.
 */
export function EventRow({ projection }: { projection: EventProjection }) {
  const { access, event } = projection;
  const title = eventTitle(projection);
  const canOpen = canOpenRow(projection);
  const showWithdraw =
    access === "attendee" &&
    event.registration?.status === "registered" &&
    !canOpen &&
    event.status !== "completed";
  // A Venue Staff row lists each request with its own period instead of the event date (PTR-138
  // AC5), exactly as the card it replaced did.
  const timingDate = access === "venue_staff" ? null : event.eventDate;
  const showTime = access !== "venue_staff";
  // With one venue the row title already names it, so the entries skip the repeat. With several
  // venues each entry keeps its name beside its period.
  const showEntryVenue =
    access === "venue_staff" &&
    new Set((event.venueRequests ?? []).map(entry => entry.venueName)).size > 1;
  // The meta list mirrors the items below, so a bare row renders no empty list.
  const showMeta =
    timingDate !== null ||
    Boolean(showTime && event.startTime && event.endTime) ||
    Boolean(event.venue?.name) ||
    (access === "attendee" && event.registration?.status === "waitlisted") ||
    (access === "attendee" && event.registration?.status === "registered");

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
        {timingDate ? <DateBlock date={timingDate} /> : undefined}
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {canOpen ? (
              <Link
                to="/events/$eventId"
                params={{ eventId: String(event.id) }}
                className="underline decoration-foreground/60 underline-offset-4 hover:decoration-foreground"
              >
                {title}
              </Link>
            ) : (
              <span>{title}</span>
            )}
          </div>
          {showMeta ? (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 body-sm text-muted-foreground">
              {timingDate ? (
                <li className="flex items-center gap-2">
                  <CalendarDays className="size-4" aria-hidden="true" />
                  {formatLocalDate(timingDate)}
                </li>
              ) : null}
              {showTime && event.startTime && event.endTime ? (
                <li className="flex items-center gap-2">
                  <Clock3 className="size-4" aria-hidden="true" />
                  {event.startTime}–{event.endTime}
                </li>
              ) : null}
              {event.venue?.name ? <li>{event.venue.name}</li> : null}
              {access === "attendee" && event.registration?.status === "waitlisted" ? (
                <li>Waiting list</li>
              ) : null}
              {access === "attendee" && event.registration?.status === "registered" ? (
                <li>Registered</li>
              ) : null}
            </ul>
          ) : null}
          {access === "venue_staff" ? null : event.description ? (
            <p className="mt-2 body-sm text-muted-foreground">{event.description}</p>
          ) : null}
        </div>
        <div className="shrink-0 md:ml-auto">
          <RowStatus projection={projection} />
        </div>
      </div>
      {access === "venue_staff" ? (
        <ul aria-label="Booking requests" className="mt-2 space-y-2 body-sm">
          {(event.venueRequests ?? []).map(entry => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {showEntryVenue ? (
                <span className="font-medium text-foreground">{entry.venueName}</span>
              ) : null}
              <span className="text-muted-foreground">{formatEntryPeriod(entry)}</span>
              <Badge variant={VENUE_REQUEST_STATUS_VARIANTS[entry.status]}>
                Venue request: {VENUE_REQUEST_STATUS_LABELS[entry.status]}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {showWithdraw ? (
        <div className="mt-2 md:ml-[4.5rem]">
          <WithdrawAction eventId={event.id} eventName={event.name ?? title} />
        </div>
      ) : null}
    </div>
  );
}
